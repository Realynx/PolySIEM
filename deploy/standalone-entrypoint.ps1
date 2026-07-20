$ErrorActionPreference = "Stop"
$Prisma = Join-Path $PSScriptRoot "prisma-cli\node_modules\.bin\prisma.cmd"
Set-Location $PSScriptRoot

& $Prisma migrate deploy --schema "prisma\schema.prisma"
if ($LASTEXITCODE -ne 0) { throw "Database migration failed with exit code $LASTEXITCODE" }

# tls-server.js serves HTTPS (self-signed by default, POLYSIEM_TLS=off opts
# out); fall back to the plain server for bundles that predate it.
if (Test-Path (Join-Path $PSScriptRoot "tls-server.js")) {
    & node "tls-server.js"
} else {
    & node "server.js"
}
exit $LASTEXITCODE
