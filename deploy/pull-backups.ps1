# Pull des backups SQLite BassOrder depuis le VPS vers ce PC.
# Usage (PowerShell) :
#   .\deploy\pull-backups.ps1
# Optionnel : planifier via le Planificateur de tâches Windows (quotidien).

param(
  [string]$Remote = "root@185.98.137.102",
  [string]$RemoteDir = "/var/backups/bassorder/",
  [string]$LocalDir = "$env:USERPROFILE\Documents\BassOrder-backups"
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null

Write-Host (">> Sync {0}:{1} -> {2}" -f $Remote, $RemoteDir, $LocalDir)
# scp récursif (fichiers .db / wal / shm)
scp -r "${Remote}:${RemoteDir}*" $LocalDir

Get-ChildItem $LocalDir | Sort-Object LastWriteTime -Descending | Select-Object -First 10 Name, Length, LastWriteTime
Write-Host "OK — backups dans $LocalDir"
Write-Host 'Astuce : chiffre ce dossier (BitLocker ou VeraCrypt) — contient des comptes cloud.'
