# One-shot: push all secrets to the Cloudflare Workers env via wrangler.
# Reads from .env at repo root. Must be run from apps/mcp-server directory.

$ErrorActionPreference = "Stop"
$envFile = Resolve-Path "$PSScriptRoot\..\.env"

$secrets = @(
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "FAL_KEY",
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "LANGFUSE_BASE_URL"
)

$envVars = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
        $envVars[$matches[1]] = $matches[2].Trim('"').Trim("'")
    }
}

Push-Location "$PSScriptRoot\..\apps\mcp-server"
try {
    foreach ($name in $secrets) {
        $value = $envVars[$name]
        if (-not $value) {
            Write-Host "⚠ $name missing from .env — skipping" -ForegroundColor Yellow
            continue
        }
        Write-Host "Setting $name..." -ForegroundColor Cyan
        $value | npx wrangler secret put $name 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ $name" -ForegroundColor Green
        } else {
            Write-Host "  ✗ $name failed" -ForegroundColor Red
        }
    }
} finally {
    Pop-Location
}
