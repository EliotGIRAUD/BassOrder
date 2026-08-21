# Security

## Reporting a vulnerability

Do **not** publish a proof of concept in a public issue.

Send a private message via [GitHub Security Advisories](https://github.com/EliotGIRAUD/BassOrder/security/advisories/new) (or a private issue / maintainer contact) with:

- problem description
- possible impact
- reproduction steps (minimal)
- version / commit concerned

Response goal: acknowledgement within a few business days, fix according to severity.

## Scope

- BassOrder desktop app (Tauri)
- Self-hosted API (`server/`) and public instance `api.bassorder.smegg.cloud`
- Site `bassorder.smegg.cloud`

Out of scope: third-party Spotify accounts, user machines, dependencies that cannot be patched immediately (we will prioritize an update).
