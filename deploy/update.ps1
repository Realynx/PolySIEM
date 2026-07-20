param(
    [string]$InstallDir = $env:POLYSIEM_INSTALL_DIR,
    [string]$HealthUrl = "http://localhost:3000/api/health"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $InstallDir) {
    $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:ProgramData }
    $InstallDir = Join-Path $base "PolySIEM"
}

$EnvFile = Join-Path $InstallDir ".env"
$ComposeFile = Join-Path $InstallDir "docker-compose.yml"
$BackupRoot = Join-Path $InstallDir "backups"
$script:RollbackArmed = $false
$script:RollbackImage = ""
$script:BackupDir = ""

function Write-PolySIEMLog([string]$Message) {
    Write-Host "[polysiem] $Message" -ForegroundColor Cyan
}

function Write-PolySIEMWarning([string]$Message) {
    Write-Warning "[polysiem] $Message"
}

function Invoke-Docker([string[]]$Arguments, [switch]$IgnoreExitCode) {
    $output = & docker @Arguments
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if (-not $IgnoreExitCode -and $exitCode -ne 0) {
        throw "docker $($Arguments -join ' ') failed with exit code $exitCode"
    }
    return $exitCode
}

function Get-EnvSetting([string]$Name) {
    $line = Get-Content -LiteralPath $EnvFile |
        Where-Object { $_ -match "^$([Regex]::Escape($Name))=" } |
        Select-Object -Last 1
    if (-not $line) { return "" }
    return (($line -split "=", 2)[1]).Trim('"', "'")
}

function Set-EnvSetting([string]$Name, [string]$Value) {
    $found = $false
    $lines = Get-Content -LiteralPath $EnvFile | ForEach-Object {
        if ($_ -match "^$([Regex]::Escape($Name))=") {
            $found = $true
            "$Name=$Value"
        } else {
            $_
        }
    }
    if (-not $found) { $lines += "$Name=$Value" }
    Set-Content -LiteralPath $EnvFile -Encoding Ascii -Value $lines
}

function Wait-PolySIEMHealth([int]$Attempts = 45) {
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Wait-Database {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        & docker compose exec -T db pg_isready -U polysiem -d polysiem *> $null
        if ($LASTEXITCODE -eq 0) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Restore-PreviousVersion {
    Write-PolySIEMWarning "Update failed; restoring the pre-update database and app image..."
    Invoke-Docker @("compose", "stop", "polysiem") -IgnoreExitCode | Out-Null
    Copy-Item -LiteralPath (Join-Path $script:BackupDir "docker-compose.yml") -Destination $ComposeFile -Force
    Copy-Item -LiteralPath (Join-Path $script:BackupDir ".env") -Destination $EnvFile -Force
    Invoke-Docker @("compose", "up", "-d", "db") -IgnoreExitCode | Out-Null
    if (-not (Wait-Database)) { return $false }

    $containerDump = "/tmp/polysiem-restore.dump"
    Invoke-Docker @("compose", "cp", (Join-Path $script:BackupDir "polysiem.dump"), "db:$containerDump") -IgnoreExitCode | Out-Null
    $dropCode = Invoke-Docker @(
        "compose", "exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1",
        "-U", "polysiem", "-d", "polysiem", "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    ) -IgnoreExitCode
    $restoreCode = 1
    if ($dropCode -eq 0) {
        $restoreCode = Invoke-Docker @(
            "compose", "exec", "-T", "db", "pg_restore", "--exit-on-error",
            "--no-owner", "--no-privileges", "-U", "polysiem", "-d", "polysiem", $containerDump
        ) -IgnoreExitCode
    }
    Invoke-Docker @("compose", "exec", "-T", "db", "rm", "-f", $containerDump) -IgnoreExitCode | Out-Null

    $overrideFile = Join-Path $script:BackupDir "rollback-compose.yml"
    Set-Content -LiteralPath $overrideFile -Encoding Ascii -Value "services:`n  polysiem:`n    image: $($script:RollbackImage)"
    Invoke-Docker @(
        "compose", "-f", $ComposeFile, "-f", $overrideFile,
        "up", "-d", "--no-deps", "--force-recreate", "polysiem"
    ) -IgnoreExitCode | Out-Null

    if ($restoreCode -eq 0 -and (Wait-PolySIEMHealth)) {
        Write-PolySIEMWarning "Rollback complete. Backup retained at $($script:BackupDir)."
        return $true
    }
    return $false
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is not installed." }
if (-not (Test-Path -LiteralPath $ComposeFile)) { throw "No docker-compose.yml found in $InstallDir." }
if (-not (Test-Path -LiteralPath $EnvFile)) { throw "No .env found in $InstallDir; refusing to update." }

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$lockPath = Join-Path $InstallDir ".update.lock"
try {
    $lock = [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
    throw "Another PolySIEM update is already running."
}

Push-Location $InstallDir
try {
    $currentImage = (& docker compose images -q polysiem | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or -not $currentImage) { throw "The installed PolySIEM image could not be found." }
    $currentImage = $currentImage.Trim()
    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
    $script:RollbackImage = "polysiem-rollback:$timestamp"
    Invoke-Docker @("image", "tag", $currentImage, $script:RollbackImage) | Out-Null

    $script:BackupDir = Join-Path $BackupRoot "pre-update-$timestamp"
    New-Item -ItemType Directory -Path $script:BackupDir | Out-Null
    Copy-Item -LiteralPath $EnvFile -Destination (Join-Path $script:BackupDir ".env")
    Copy-Item -LiteralPath $ComposeFile -Destination (Join-Path $script:BackupDir "docker-compose.yml")

    Write-PolySIEMLog "Creating pre-update PostgreSQL backup..."
    Invoke-Docker @("compose", "up", "-d", "db") | Out-Null
    if (-not (Wait-Database)) { throw "PostgreSQL did not become ready; no update was attempted." }
    $containerDump = "/tmp/polysiem-pre-update-$timestamp.dump"
    Invoke-Docker @(
        "compose", "exec", "-T", "db", "pg_dump", "--format=custom",
        "--no-owner", "--no-privileges", "-U", "polysiem", "-d", "polysiem", "-f", $containerDump
    ) | Out-Null
    $dumpFile = Join-Path $script:BackupDir "polysiem.dump"
    Invoke-Docker @("compose", "cp", "db:$containerDump", $dumpFile) | Out-Null
    Invoke-Docker @("compose", "exec", "-T", "db", "rm", "-f", $containerDump) -IgnoreExitCode | Out-Null
    if ((Get-Item -LiteralPath $dumpFile).Length -eq 0) { throw "Database backup is empty; no update was attempted." }

    Invoke-Docker @("compose", "stop", "polysiem") | Out-Null
    $script:RollbackArmed = $true

    $repository = Get-EnvSetting "POLYSIEM_GITHUB_REPOSITORY"
    if ($repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
        throw "POLYSIEM_GITHUB_REPOSITORY must use owner/repository format."
    }
    $releaseBase = "https://github.com/$repository/releases/latest/download"
    $manifestFile = Join-Path $script:BackupDir "release-manifest.json"
    $candidate = Join-Path $script:BackupDir "docker-compose.next.yml"
    $updateCandidate = Join-Path $script:BackupDir "update.next.ps1"
    Write-PolySIEMLog "Downloading and validating the latest release deployment..."
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/release-manifest.json" -OutFile $manifestFile
    $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
    $releaseImage = [string]$manifest.image
    if ($releaseImage -notmatch '^ghcr\.io/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$') {
        throw "The GitHub release manifest contains an invalid container image."
    }
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/docker-compose.yml" -OutFile $candidate
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/update.ps1" -OutFile $updateCandidate
    Invoke-Docker @("compose", "--env-file", $EnvFile, "-f", $candidate, "config", "-q") | Out-Null
    Copy-Item -LiteralPath $candidate -Destination $ComposeFile -Force
    Set-EnvSetting "POLYSIEM_IMAGE" $releaseImage

    Write-PolySIEMLog "Pulling and starting the latest release..."
    Invoke-Docker @("compose", "pull", "polysiem") | Out-Null
    Invoke-Docker @("compose", "up", "-d", "db") | Out-Null
    Invoke-Docker @("compose", "up", "-d", "--no-deps", "--force-recreate", "polysiem") | Out-Null

    if (-not (Wait-PolySIEMHealth)) { throw "The new release did not become healthy within 90 seconds." }
    $script:RollbackArmed = $false
    Write-PolySIEMLog "Update complete. Backup: $($script:BackupDir)"
    Write-PolySIEMLog "Previous image retained as $($script:RollbackImage)."
    try {
        Copy-Item -LiteralPath $updateCandidate -Destination (Join-Path $InstallDir "update.ps1") -Force
    } catch {
        Write-PolySIEMWarning "PolySIEM updated, but update.ps1 could not refresh itself: $($_.Exception.Message)"
    }
} catch {
    $failure = $_
    if ($script:RollbackArmed) {
        if (-not (Restore-PreviousVersion)) {
            Write-PolySIEMWarning "Automatic rollback did not complete. Keep $($script:BackupDir) and inspect Docker logs."
        }
    }
    throw $failure
} finally {
    Pop-Location
    $lock.Dispose()
}
