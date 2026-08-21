#!/usr/bin/env bash
# À coller sur le VPS (root@vps120699) — une seule fois
set -euo pipefail

PUBKEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHN2Be6gqIBIB/+PZO5960cCOscb8UrG55EYNAttmbE8 eliotgiraud@gmail.com'
APP_ROOT=/opt/bassorder
WWW_ROOT=/var/www/bassorder

echo "==> SSH authorized_keys"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
grep -qxF "$PUBKEY" ~/.ssh/authorized_keys || echo "$PUBKEY" >> ~/.ssh/authorized_keys

echo "==> Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx git curl ca-certificates openssl certbot python3-certbot-nginx

# Docker (Debian)
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y docker.io docker-compose-v2 || apt-get install -y docker.io
  systemctl enable --now docker
fi
# compose plugin fallback
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-plugin 2>/dev/null || true
fi

echo "==> Clone / update repo"
if [[ ! -d "$APP_ROOT/.git" ]]; then
  git clone https://github.com/EliotGIRAUD/BassOrder.git "$APP_ROOT"
else
  git -C "$APP_ROOT" fetch origin
  git -C "$APP_ROOT" reset --hard origin/main
fi

echo "==> Landing"
mkdir -p "$WWW_ROOT/downloads"
cp "$APP_ROOT/deploy/landing/index.html" "$WWW_ROOT/index.html"

echo "==> Nginx vhosts (sans toucher smegg.cloud)"
cp "$APP_ROOT/deploy/nginx/bassorder.smegg.cloud.conf" /etc/nginx/sites-available/
cp "$APP_ROOT/deploy/nginx/api.bassorder.smegg.cloud.conf" /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/bassorder.smegg.cloud.conf /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/api.bassorder.smegg.cloud.conf /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

echo "==> API env + Docker"
if [[ ! -f "$APP_ROOT/deploy/.env" ]]; then
  SECRET=$(openssl rand -hex 32)
  printf 'BASSORDER_JWT_SECRET=%s\n' "$SECRET" > "$APP_ROOT/deploy/.env"
  chmod 600 "$APP_ROOT/deploy/.env"
  echo "JWT secret écrit dans $APP_ROOT/deploy/.env"
fi

cd "$APP_ROOT"
if docker compose version >/dev/null 2>&1; then
  docker compose -f deploy/docker-compose.yml up -d --build
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose -f deploy/docker-compose.yml up -d --build
else
  echo "ERREUR: docker compose indisponible" >&2
  exit 1
fi

echo "==> Health local"
sleep 3
curl -fsS http://127.0.0.1:8787/health || echo "(API pas encore joignable — check docker logs)"

echo "==> Certbot (nécessite DNS A pour bassorder + api.bassorder)"
if certbot --nginx -d bassorder.smegg.cloud -d api.bassorder.smegg.cloud \
  --non-interactive --agree-tos -m eliot.giraud@my-digital-school.org --redirect; then
  echo "TLS OK"
else
  echo "Certbot en attente DNS. Crée les enregistrements A puis relance :"
  echo "  certbot --nginx -d bassorder.smegg.cloud -d api.bassorder.smegg.cloud"
fi

echo "==> DONE"
echo "Landing: http://bassorder.smegg.cloud (après DNS)"
echo "API:     http://api.bassorder.smegg.cloud/health"
echo "Upload MSI ensuite dans $WWW_ROOT/downloads/"
