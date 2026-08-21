# Déploiement BassOrder (VPS)

Cible : `185.98.137.102` / domaine `smegg.cloud` (sans toucher au site SMEGG principal).

## DNS

Créer deux enregistrements A :

| Host | Type | Valeur |
|------|------|--------|
| `bassorder` | A | `185.98.137.102` |
| `api.bassorder` | A | `185.98.137.102` |

(chez le registrar / panel DNS de `smegg.cloud`)

## Bootstrap

Sur le VPS (root), après push GitHub :

```bash
curl -fsSL https://raw.githubusercontent.com/EliotGIRAUD/BassOrder/main/deploy/bootstrap.sh | bash
# ou :
git clone https://github.com/EliotGIRAUD/BassOrder.git /opt/bassorder
bash /opt/bassorder/deploy/bootstrap.sh
```

Puis uploader l’installateur Windows vers `/var/www/bassorder/downloads/`.

## Fichiers

- `docker-compose.yml` — API Rust + volume SQLite (non-root, caps drop)
- `nginx/*.conf` — vhosts (+ snippets headers / rate-limit)
- `harden-vps.sh` — firewall, fail2ban, SSH, nginx sécu, backups
- `backup-sqlite.sh` — dump quotidien volume SQLite
- `landing/` — page de téléchargement
- `.env.example` — modèle secret JWT

Après un déploiement existant :

```bash
cd /opt/bassorder && git pull
bash deploy/harden-vps.sh
```
