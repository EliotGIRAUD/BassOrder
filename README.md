# BassOrder

Trie ta musique par genre — **Spotify** et **bibliothèque locale**, deux modules indépendants.

**Télécharger (Windows)** : [bassorder.smegg.cloud](https://bassorder.smegg.cloud)  
**API cloud** : [api.bassorder.smegg.cloud](https://api.bassorder.smegg.cloud) · `GET /health`  
**Stack** : Tauri 2 + React + TypeScript + Vite · SQLite locale · API Rust (Axum) self-host

## Installer l’app

1. Ouvre [bassorder.smegg.cloud](https://bassorder.smegg.cloud) et télécharge l’installateur `.msi`.
2. Lance BassOrder.
3. (Optionnel) Rail **Compte** → connecte le cloud ; l’URL API par défaut en build prod est `https://api.bassorder.smegg.cloud`.

## Dev (Windows / PowerShell)

```bash
cd C:\Users\eliot\Documents\travail\BassOrder
pnpm install
pnpm tauri dev
```

UI seule (navigateur, sans SQLite Tauri) :

```bash
pnpm dev
```

API locale :

```bash
pnpm api
# http://127.0.0.1:8787
```

Build installateur :

```bash
# Prod API URL baked into the frontend:
# $env:VITE_BASSORDER_API="https://api.bassorder.smegg.cloud"
pnpm tauri build
```

Artefacts : `src-tauri/target/release/bundle/`.

## Modules

| Module | Rôle |
|--------|------|
| Spotify | OAuth → analyse → playlists par genre |
| Local | Dossier PC → tags → aperçu → copie ou déplacement par genre |

Le module **Local** nécessite la fenêtre Tauri. Par défaut les fichiers sont **copiés** dans des sous-dossiers (Rock, Jazz, Sans genre…).

## Base de données locale

Tout est stocké dans un fichier SQLite :

`%APPDATA%\com.eliot.bassorder\bassorder.db`

Paramètres → **Ouvrir le dossier de la base**.

## Compte & API cloud

- Rail **Compte** : login cloud (email), PIN local, favoris / presets, **Sync knowledge** (miroir + pool).
- Self-host : dossier [`server/`](server/) — détails dans [`server/README.md`](server/README.md).
- Déploiement VPS : [`deploy/`](deploy/) (`docker compose`, Nginx, Certbot).

```bash
# Variable front (build)
VITE_BASSORDER_API=https://api.bassorder.smegg.cloud
```

## Licence

Projet personnel / école — voir le dépôt pour les évolutions.
