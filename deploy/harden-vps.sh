#!/usr/bin/env bash
# Durcissement VPS BassOrder (idempotent) — cohabite avec SMEGG.
# Usage (root) : bash /opt/bassorder/deploy/harden-vps.sh
set -euo pipefail

APP_ROOT=/opt/bassorder
WWW_ROOT=/var/www/bassorder
DEPLOY="$APP_ROOT/deploy"

echo "==> Packages sécu"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ufw fail2ban unattended-upgrades apt-listchanges curl ca-certificates

echo "==> SSH durci (clés only)"
mkdir -p /etc/ssh/sshd_config.d
# Sur Debian, Include est en haut du fichier : les valeurs du sshd_config principal
# après l’Include gagnent. On corrige aussi le fichier principal.
sed -i -E 's/^[#[:space:]]*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i -E 's/^[#[:space:]]*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i -E 's/^[#[:space:]]*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
grep -q '^PasswordAuthentication no' /etc/ssh/sshd_config || echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config
grep -q '^PermitRootLogin prohibit-password' /etc/ssh/sshd_config || echo 'PermitRootLogin prohibit-password' >> /etc/ssh/sshd_config
cat >/etc/ssh/sshd_config.d/99-bassorder-harden.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
X11Forwarding no
PermitEmptyPasswords no
MaxAuthTries 4
LoginGraceTime 30
EOF
sshd -t
systemctl reload ssh || systemctl reload sshd

echo "==> Fail2ban"
# Debian journald : pas de /var/log/auth.log → backend systemd
cat >/etc/fail2ban/jail.d/bassorder-sshd.conf <<'EOF'
[DEFAULT]
backend = systemd

[sshd]
enabled = true
port = ssh
filter = sshd
backend = systemd
maxretry = 4
findtime = 10m
bantime = 1h
EOF
systemctl enable fail2ban
systemctl restart fail2ban
sleep 1
fail2ban-client status sshd | head -20

echo "==> UFW (22/80/443) — ne coupe pas la session courante"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
# Si OpenSSH profile absent :
ufw allow 22/tcp || true
ufw --force enable
ufw status verbose

# MySQL / Node étaient en 0.0.0.0 — UFW les coupe de l’extérieur (80/443/22 only).
# Accès local (127.0.0.1) inchangé pour SMEGG.
if ss -tulpn 2>/dev/null | grep -q ':3306'; then
  echo "NOTE: MySQL écoute publiquement — désormais filtré par UFW (garder bind local si possible)."
fi

echo "==> unattended-upgrades"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

echo "==> Nginx snippets + rate-limit"
mkdir -p /etc/nginx/snippets /etc/nginx/conf.d
cp "$DEPLOY/nginx/conf.d/bassorder-rate-limit.conf" /etc/nginx/conf.d/
cp "$DEPLOY/nginx/snippets/security-headers.conf" /etc/nginx/snippets/bassorder-security-headers.conf
cp "$DEPLOY/nginx/snippets/api-proxy.conf" /etc/nginx/snippets/bassorder-api-proxy.conf

# Réécrit les vhosts BassOrder en gardant les chemins Certbot existants
CERT_LIVE=/etc/letsencrypt/live/bassorder.smegg.cloud
if [[ -f "$CERT_LIVE/fullchain.pem" ]]; then
  cat >/etc/nginx/sites-available/api.bassorder.smegg.cloud.conf <<'NGX'
# API — géré par harden-vps.sh (TLS Certbot conservé)
server {
    server_name api.bassorder.smegg.cloud;

    location /auth/ {
        limit_req zone=bassorder_auth burst=10 nodelay;
        limit_conn bassorder_conn 20;
        include /etc/nginx/snippets/bassorder-api-proxy.conf;
        include /etc/nginx/snippets/bassorder-security-headers.conf;
        proxy_pass http://127.0.0.1:8787;
    }

    location / {
        limit_req zone=bassorder_api burst=60 nodelay;
        limit_conn bassorder_conn 40;
        include /etc/nginx/snippets/bassorder-api-proxy.conf;
        include /etc/nginx/snippets/bassorder-security-headers.conf;
        proxy_pass http://127.0.0.1:8787;
    }

    listen [::]:443 ssl;
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/bassorder.smegg.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bassorder.smegg.cloud/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = api.bassorder.smegg.cloud) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    listen [::]:80;
    server_name api.bassorder.smegg.cloud;
    return 404;
}
NGX

  cat >/etc/nginx/sites-available/bassorder.smegg.cloud.conf <<'NGX'
# Landing — géré par harden-vps.sh (TLS Certbot conservé)
server {
    server_name bassorder.smegg.cloud;

    root /var/www/bassorder;
    index index.html;

    include /etc/nginx/snippets/bassorder-security-headers.conf;
    add_header Content-Security-Policy "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;

    location / {
        try_files $uri $uri/ =404;
    }

    location /downloads/ {
        alias /var/www/bassorder/downloads/;
        add_header Content-Disposition 'attachment';
        add_header X-Content-Type-Options "nosniff" always;
        types {
            application/octet-stream msi exe;
        }
        autoindex off;
    }

    listen [::]:443 ssl;
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/bassorder.smegg.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bassorder.smegg.cloud/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = bassorder.smegg.cloud) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    listen [::]:80;
    server_name bassorder.smegg.cloud;
    return 404;
}
NGX
else
  echo "WARN: certificats Let's Encrypt absents — copie des vhosts HTTP du repo"
  cp "$DEPLOY/nginx/api.bassorder.smegg.cloud.conf" /etc/nginx/sites-available/
  cp "$DEPLOY/nginx/bassorder.smegg.cloud.conf" /etc/nginx/sites-available/
fi

ln -sf /etc/nginx/sites-available/api.bassorder.smegg.cloud.conf /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/bassorder.smegg.cloud.conf /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

echo "==> Permissions landing / downloads"
mkdir -p "$WWW_ROOT/downloads"
chown -R root:www-data "$WWW_ROOT"
find "$WWW_ROOT" -type d -exec chmod 755 {} \;
find "$WWW_ROOT" -type f -exec chmod 644 {} \;

echo "==> Secrets .env"
if [[ -f "$DEPLOY/.env" ]]; then
  chmod 600 "$DEPLOY/.env"
  if grep -qi 'ALLOW_INSECURE_DEV=1' "$DEPLOY/.env"; then
    echo "ERREUR: BASSORDER_ALLOW_INSECURE_DEV=1 en prod — retire-le" >&2
    exit 1
  fi
fi

echo "==> Backup SQLite quotidien"
install -m 755 "$DEPLOY/backup-sqlite.sh" /usr/local/sbin/bassorder-backup-sqlite.sh
mkdir -p /var/backups/bassorder
chmod 700 /var/backups/bassorder
cat >/etc/cron.d/bassorder-backup <<'EOF'
15 3 * * * root /usr/local/sbin/bassorder-backup-sqlite.sh >/var/log/bassorder-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/bassorder-backup

echo "==> Docker rebuild (non-root + hardening)"
cd "$APP_ROOT"
# Volume ownership pour UID 10001
VOL=$(docker volume ls -q | grep -E 'bassorder.*data' | head -1 || true)
if [[ -n "${VOL:-}" ]]; then
  docker run --rm -v "$VOL":/data alpine chown -R 10001:10001 /data || true
fi
if docker compose version >/dev/null 2>&1; then
  docker compose -f deploy/docker-compose.yml up -d --build
else
  docker-compose -f deploy/docker-compose.yml up -d --build
fi

sleep 3
curl -fsS http://127.0.0.1:8787/health
curl -fsSI https://api.bassorder.smegg.cloud/health | head -15 || true

echo "==> Bind MySQL / SMEGG en localhost + server_tokens"
bash "$DEPLOY/harden-localhost-binds.sh"

echo "==> DONE harden-vps"
echo "Vérifs : ufw status ; fail2ban-client status sshd ; docker port bassorder-api"
echo "Pull backups PC : deploy/pull-backups.ps1"
