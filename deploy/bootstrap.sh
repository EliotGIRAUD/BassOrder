#!/usr/bin/env bash
# Bootstrap VPS BassOrder (à lancer en root sur 185.98.137.102)
# Prérequis DNS : bassorder.smegg.cloud + api.bassorder.smegg.cloud → IP du VPS
set -euo pipefail

APP_ROOT=/opt/bassorder
WWW_ROOT=/var/www/bassorder

apt-get update
apt-get install -y nginx docker.io docker-compose-v2 certbot python3-certbot-nginx git

mkdir -p "$APP_ROOT" "$WWW_ROOT/downloads"
if [[ ! -d "$APP_ROOT/.git" ]]; then
  git clone https://github.com/EliotGIRAUD/BassOrder.git "$APP_ROOT"
else
  git -C "$APP_ROOT" pull --ff-only
fi

cp "$APP_ROOT/deploy/landing/index.html" "$WWW_ROOT/index.html"
cp "$APP_ROOT/deploy/nginx/"*.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/bassorder.smegg.cloud.conf /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/api.bassorder.smegg.cloud.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

if [[ ! -f "$APP_ROOT/deploy/.env" ]]; then
  SECRET=$(openssl rand -hex 32)
  printf 'BASSORDER_JWT_SECRET=%s\n' "$SECRET" > "$APP_ROOT/deploy/.env"
  chmod 600 "$APP_ROOT/deploy/.env"
  echo "Créé $APP_ROOT/deploy/.env (JWT secret généré)"
fi

cd "$APP_ROOT"
docker compose -f deploy/docker-compose.yml up -d --build

certbot --nginx -d bassorder.smegg.cloud -d api.bassorder.smegg.cloud --non-interactive --agree-tos -m eliot.giraud@my-digital-school.org --redirect || {
  echo "Certbot a échoué — vérifie que les DNS pointent bien vers ce serveur, puis relance :"
  echo "  certbot --nginx -d bassorder.smegg.cloud -d api.bassorder.smegg.cloud"
}

curl -fsS http://127.0.0.1:8787/health || true
echo "Bootstrap terminé."
