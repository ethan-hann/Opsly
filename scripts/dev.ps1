# dev.ps1 - start the full local dev stack (API + frontend) in one terminal.
#
# First run (or any fresh local DB volume):
#   ./scripts/dev.ps1 -Setup
#
# Later runs:
#   ./scripts/dev.ps1
#
# Alternatively, call the cross-platform npm scripts directly (works on all shells):
#   pnpm run setup    # first run or after recreating the DB volume
#   pnpm run dev      # start API + frontend

param(
    [switch]$Setup
)

# Load .env from repo root if it exists (only sets vars that are not already set).
$envFile = Join-Path $PSScriptRoot ".." ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
        $parts = $_ -split '=', 2
        if ($parts.Count -eq 2) {
            $key = $parts[0].Trim()
            $val = $parts[1].Trim()
            if (-not (Test-Path "Env:$key")) {
                Set-Item "Env:$key" $val
            }
        }
    }
}

# Apply defaults for shared env vars (DATABASE_URL, AUTH_MODE, etc.).
if (-not $env:DATABASE_URL)        { $env:DATABASE_URL        = "postgres://postgres:postgres@localhost:5432/opsly" }
if (-not $env:AUTH_MODE)           { $env:AUTH_MODE           = "local" }
if (-not $env:STORAGE_DRIVER)      { $env:STORAGE_DRIVER      = "local" }
if (-not $env:LOCAL_STORAGE_PATH)  { $env:LOCAL_STORAGE_PATH  = ".\data\exports" }
if (-not $env:INSTANCE_ADMIN_TOKEN){ $env:INSTANCE_ADMIN_TOKEN = "local-dev-admin-token" }
if (-not $env:NODE_ENV)            { $env:NODE_ENV            = "development" }

if ($Setup) {
    Write-Host "==> Running setup (DB schema push + default local user)..." -ForegroundColor Cyan
    # Use the cross-platform npm setup script (pnpm run setup uses hardcoded defaults).
    # For custom user credentials, set LOCAL_DEV_USER_* env vars or edit .env before running.
    pnpm run setup
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "==> Setup complete." -ForegroundColor Green
} else {
    Write-Host "==> If this is your first native run or you recreated the DB volume, run ./scripts/dev.ps1 -Setup first." -ForegroundColor Yellow
}

Write-Host "==> Starting API server (:8080) and frontend (:20999)..." -ForegroundColor Cyan

# `pnpm run dev` uses concurrently + cross-env and works cross-platform.
pnpm run dev

