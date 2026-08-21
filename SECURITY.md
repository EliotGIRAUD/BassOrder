# Sécurité

## Signaler une faille

Ne publie **pas** de preuve d’exploitation en issue publique.

Envoie un message privé via [GitHub Security Advisories](https://github.com/EliotGIRAUD/BassOrder/security/advisories/new) (ou une issue privée / contact mainteneur) avec :

- description du problème
- impact possible
- étapes de reproduction (minimales)
- version / commit concernés

Objectif de réponse : acknowledgement sous quelques jours ouvrés, correctif selon gravité.

## Portée

- App desktop BassOrder (Tauri)
- API self-hostée (`server/`) et instance publique `api.bassorder.smegg.cloud`
- Site `bassorder.smegg.cloud`

Hors scope : comptes Spotify tiers, machines utilisateurs, dépendances non patchables immédiatement (on priorisera une mise à jour).
