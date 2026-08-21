# Snippets Certbot (après DNS OK)
#
# apt install -y certbot python3-certbot-nginx
# certbot --nginx -d bassorder.smegg.cloud -d api.bassorder.smegg.cloud
#
# Les vhosts HTTP dans deploy/nginx/ seront enrichis automatiquement
# (listen 443 ssl + redirect HTTP→HTTPS) par certbot --nginx.
