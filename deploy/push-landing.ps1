# Deploy BassOrder landing (+ SEO assets) to production VPS.
# Usage: .\deploy\push-landing.ps1
# Does NOT touch /downloads installers on the VPS.

param(
  [string]$Remote = "root@185.98.137.102",
  [string]$Key = "$env:USERPROFILE\.ssh\id_ed25519",
  [string]$LocalLanding = "$PSScriptRoot\landing"
)

$ErrorActionPreference = "Stop"
$sshOpts = @("-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-i", $Key)

$files = @(
  "index.html",
  "landing.js",
  "legal.css",
  "terms.html",
  "privacy.html",
  "mentions.html",
  "favicon.ico",
  "favicon.png",
  "logo.svg",
  "apple-touch-icon.png",
  "og-image.png",
  "robots.txt",
  "sitemap.xml",
  "site.webmanifest"
)

# Google Search Console ownership proof (keep after validation)
$googleVerify = Get-ChildItem -LiteralPath $LocalLanding -Filter "google*.html" -File -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty Name
if ($googleVerify) {
  $files += $googleVerify
}

foreach ($name in $files) {
  $src = Join-Path $LocalLanding $name
  if (-not (Test-Path -LiteralPath $src)) {
    throw "Missing file: $src"
  }
}

Write-Host ">> Upload HTML/CSS/JS + SEO assets"
$paths = $files | ForEach-Object { Join-Path $LocalLanding $_ }
& scp @sshOpts @paths "${Remote}:/var/www/bassorder/"
if ($LASTEXITCODE -ne 0) { throw "scp www failed: $LASTEXITCODE" }
& scp @sshOpts @paths "${Remote}:/opt/bassorder/deploy/landing/"
if ($LASTEXITCODE -ne 0) { throw "scp opt failed: $LASTEXITCODE" }

$clipsMeta = @(
  (Join-Path $LocalLanding "clips\clips.json"),
  (Join-Path $LocalLanding "clips\README.md")
) | Where-Object { Test-Path -LiteralPath $_ }
if ($clipsMeta.Count -gt 0) {
  Write-Host ">> Upload clips metadata"
  & scp @sshOpts @clipsMeta "${Remote}:/var/www/bassorder/clips/"
  if ($LASTEXITCODE -ne 0) { throw "scp clips failed: $LASTEXITCODE" }
  & scp @sshOpts @clipsMeta "${Remote}:/opt/bassorder/deploy/landing/clips/"
  if ($LASTEXITCODE -ne 0) { throw "scp opt clips failed: $LASTEXITCODE" }
}

Write-Host ">> Sync harden-vps.sh"
& scp @sshOpts (Join-Path $PSScriptRoot "harden-vps.sh") "${Remote}:/opt/bassorder/deploy/harden-vps.sh"
if ($LASTEXITCODE -ne 0) { throw "scp harden failed: $LASTEXITCODE" }

Write-Host ">> Fix permissions"
& ssh @sshOpts $Remote "chown -R root:www-data /var/www/bassorder; find /var/www/bassorder -maxdepth 1 -type f -exec chmod 644 {} +; ls -la /var/www/bassorder/favicon.ico /var/www/bassorder/logo.svg /var/www/bassorder/og-image.png /var/www/bassorder/robots.txt /var/www/bassorder/sitemap.xml /var/www/bassorder/index.html"
if ($LASTEXITCODE -ne 0) { throw "ssh perms failed: $LASTEXITCODE" }

Write-Host "OK - landing deployed"
