# ═══════════════════════════════════════════════════════════════════════
#  Foos — one-time signing setup (FRESH keystore, dedicated to Foos)
#
#  Run this ONCE from the project root:  .\scripts\setup-signing.ps1
#
#  It will:
#    1. Generate android/app/upload-keystore.jks (you pick the passwords)
#    2. Write android/key.properties so LOCAL release builds are signed
#    3. Print the four values to paste into GitHub → repo → Settings →
#       Secrets and variables → Actions, so CI builds are signed too.
#
#  ⚠ BACK UP the .jks file AND the passwords somewhere safe (password
#    manager). This key is IRREPLACEABLE — every future Foos update must be
#    signed with it or your phone will refuse to install over the old app.
#    (.jks and key.properties are gitignored — they never leave your machine
#     except as the encrypted CI secret.)
# ═══════════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$keytool = "$env:JAVA_HOME\bin\keytool.exe"
if (-not (Test-Path $keytool)) {
    $keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source
}
if (-not $keytool) {
    Write-Error "keytool not found. Install a JDK (you have Eclipse Adoptium 17) or set JAVA_HOME."
    exit 1
}

$jks = "android\app\upload-keystore.jks"
if (Test-Path $jks) {
    Write-Host "A keystore already exists at $jks — refusing to overwrite it." -ForegroundColor Yellow
    Write-Host "Delete it manually first ONLY if you are certain you have no releases signed with it." -ForegroundColor Yellow
    exit 1
}

$alias = "foos"
$storePass = Read-Host "Choose a keystore (store) password" -AsSecureString
$storePassPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePass))

# Use the same password for the key to keep it simple (Android allows this).
& $keytool -genkeypair -v `
    -keystore $jks `
    -alias $alias `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $storePassPlain -keypass $storePassPlain `
    -dname "CN=Foos, OU=scenicprints, O=scenicprints, C=US"

# --- local key.properties (gitignored) ---
@"
storePassword=$storePassPlain
keyPassword=$storePassPlain
keyAlias=$alias
storeFile=upload-keystore.jks
"@ | Set-Content -Path "android\key.properties" -Encoding utf8
Write-Host "Wrote android\key.properties (local signing)." -ForegroundColor Green

# --- base64 for the CI secret ---
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($jks))
$b64 | Set-Content -Path "scripts\keystore.base64.txt" -Encoding ascii

Write-Host ""
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " Add these 4 secrets to the GitHub repo (scenicprints/foos):" -ForegroundColor Cyan
Write-Host "   Settings → Secrets and variables → Actions → New secret" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  KEY_ALIAS        = $alias"
Write-Host "  STORE_PASSWORD   = (the password you just chose)"
Write-Host "  KEY_PASSWORD     = (the same password)"
Write-Host "  KEYSTORE_BASE64  = the contents of scripts\keystore.base64.txt"
Write-Host ""
Write-Host "After adding the secrets, DELETE scripts\keystore.base64.txt." -ForegroundColor Yellow
Write-Host "Back up android\app\upload-keystore.jks + the password now." -ForegroundColor Yellow
