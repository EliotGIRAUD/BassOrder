# Brouillon de post — BassOrder

## LinkedIn / X (court)

J’ai mis en ligne **BassOrder** : une app Windows pour trier sa musique par genre — Spotify et fichiers locaux.

Stack : Tauri 2 + React + TypeScript, SQLite en local, et une API Rust self-host pour le compte cloud / sync de knowledge (miroir + pool).

- Télécharger : https://bassorder.smegg.cloud
- Code (public) : https://github.com/EliotGIRAUD/BassOrder
- API : https://api.bassorder.smegg.cloud/health

Prochaine étape : simplifier le parcours utilisateur — aujourd’hui on se perd un peu dans l’app, je veux un onboarding limpide.

## Version un peu plus longue

BassOrder est né d’un vrai besoin : classer une bibliothèque musicale sans y passer des heures.

L’app desktop (Tauri) lit Spotify et un dossier local, propose des genres, et laisse copier/déplacer les fichiers. Les données restent sur la machine (SQLite). En option, un compte cloud synchronise la « knowledge » (classements artistes) via une API que j’héberge moi-même sur mon VPS.

Tout est open source sur GitHub. Feedback bienvenu — surtout sur ce qui n’est pas clair à la première ouverture.
