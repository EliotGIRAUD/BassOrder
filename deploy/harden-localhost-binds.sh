#!/usr/bin/env bash
# Bind services sensibles en localhost + petits extras nginx.
# Appelé depuis harden-vps.sh ou seul : bash deploy/harden-localhost-binds.sh
set -euo pipefail

echo "==> MySQL bind 127.0.0.1 (3306 + mysqlx 33060)"
mkdir -p /etc/mysql/mysql.conf.d
cat >/etc/mysql/mysql.conf.d/99-bassorder-localhost.cnf <<'EOF'
# BassOrder / VPS harden — MySQL uniquement en local
[mysqld]
bind-address = 127.0.0.1
mysqlx-bind-address = 127.0.0.1
EOF
systemctl restart mysql
sleep 2
ss -tulpn | grep -E '3306|33060' || true

echo "==> Nginx server_tokens off"
if grep -qE '^\s*server_tokens\s+off' /etc/nginx/nginx.conf; then
  echo "server_tokens déjà off"
elif grep -qE '^\s*#?\s*server_tokens' /etc/nginx/nginx.conf; then
  sed -i -E 's/^\s*#?\s*server_tokens.*/\tserver_tokens off;/' /etc/nginx/nginx.conf
else
  sed -i '/http {/a\\tserver_tokens off;' /etc/nginx/nginx.conf
fi
rm -f /etc/nginx/conf.d/00-server-tokens.conf
nginx -t
systemctl reload nginx

echo "==> SMEGG (PM2) bind 127.0.0.1:3000"
ECO=/var/www/smegg/ecosystem.config.cjs
if [[ -f "$ECO" ]]; then
  cp -a "$ECO" "$ECO.bak.$(date +%Y%m%d%H%M%S)"
  # Réécrit un ecosystem minimal sûr (conserve script/cwd)
  cat >"$ECO" <<'EOF'
const path = require('path')

module.exports = {
  apps: [
    {
      name: 'smegg',
      script: '.output/server/index.mjs',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      node_args: `--env-file=${path.join(__dirname, '.env')}`,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        NITRO_HOST: '127.0.0.1',
        PORT: '3000'
      },
      max_memory_restart: '500M',
      autorestart: true,
      watch: false
    }
  ]
}
EOF
  cd /var/www/smegg
  pm2 delete smegg 2>/dev/null || true
  pm2 start ecosystem.config.cjs
  pm2 save
  sleep 2
  ss -tulpn | grep ':3000' || true
else
  echo "WARN: $ECO absent — skip PM2 bind"
fi

echo "==> Vérifs HTTP"
curl -fsSI https://smegg.cloud/ | head -12 || echo "WARN smegg.cloud"
curl -fsSI https://api.bassorder.smegg.cloud/health | head -12 || echo "WARN api"
curl -fsSI https://bassorder.smegg.cloud/ | head -12 || echo "WARN landing"

echo "==> DONE localhost binds"
