$ErrorActionPreference = "Stop"
$Prisma = Join-Path $PSScriptRoot "prisma-cli\node_modules\.bin\prisma.cmd"
Set-Location $PSScriptRoot

& $Prisma migrate deploy --schema "prisma\schema.prisma"
if ($LASTEXITCODE -ne 0) { throw "Database migration failed with exit code $LASTEXITCODE" }

& node "server.js"
exit $LASTEXITCODE
