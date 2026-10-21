param(
    [Parameter(Mandatory = $true)]
    [string] $UnsignedApk,

    [Parameter(Mandatory = $true)]
    [string] $ApkSignerJar,

    [string] $OutputApk
)

$ErrorActionPreference = 'Stop'

function Stop-Signing([string] $Message) {
    throw $Message
}

$keyDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'tmp\next-step-signing-private'
$keystore = Join-Path $keyDirectory 'next-step.jks'
$protectedPasswordFile = Join-Path $keyDirectory 'password.dpapi'
$certificateSha256 = '5dbef3dafc6b483fa4bc80d68ae7733a9714c2371e67850af17e6814e939402d'

if (-not (Test-Path -LiteralPath $UnsignedApk -PathType Leaf)) {
    Stop-Signing '找不到 unsigned APK。'
}
if (-not (Test-Path -LiteralPath $ApkSignerJar -PathType Leaf)) {
    Stop-Signing '找不到 apksigner.jar。'
}
if (-not (Test-Path -LiteralPath $keystore -PathType Leaf) -or
    -not (Test-Path -LiteralPath $protectedPasswordFile -PathType Leaf)) {
    Stop-Signing '本机签名密钥或 DPAPI 加密密码文件不存在。'
}

$unsignedPath = (Resolve-Path -LiteralPath $UnsignedApk).Path
$signerPath = (Resolve-Path -LiteralPath $ApkSignerJar).Path
if (-not $OutputApk) {
    $inputFile = Get-Item -LiteralPath $unsignedPath
    $outputName = $inputFile.Name -replace '-unsigned(?=\.apk$)', '-signed'
    if ($outputName -eq $inputFile.Name) {
        $outputName = [System.IO.Path]::GetFileNameWithoutExtension($inputFile.Name) + '-signed.apk'
    }
    $OutputApk = Join-Path $inputFile.DirectoryName $outputName
}
$outputPath = [System.IO.Path]::GetFullPath($OutputApk)
if ([string]::Equals($outputPath, $unsignedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-Signing '输出文件不能覆盖 unsigned APK。'
}
if (Test-Path -LiteralPath $outputPath) {
    Stop-Signing '输出文件已存在；为避免覆盖，请指定新的 -OutputApk 路径。'
}

$java = $null
$preferredJava = 'C:\Program Files\Java\jdk1.8.0_181\bin\java.exe'
if (Test-Path -LiteralPath $preferredJava -PathType Leaf) {
    $java = $preferredJava
} else {
    $javaCommand = Get-Command 'java.exe' -ErrorAction SilentlyContinue
    if ($javaCommand) { $java = $javaCommand.Source }
}
if (-not $java) {
    Stop-Signing '找不到 Java。请安装 Java，并确保 java.exe 可用。'
}

try {
    Add-Type -AssemblyName System.Security
    $protectedBytes = [System.IO.File]::ReadAllBytes($protectedPasswordFile)
    $passwordBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $protectedBytes,
        $null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $password = [System.Text.Encoding]::UTF8.GetString($passwordBytes)
} catch {
    Stop-Signing 'Windows 无法解锁此账户加密的签名密码；请使用创建该密码文件的 Windows 账户。'
} finally {
    if ($passwordBytes) {
        [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    }
}

$environmentName = 'NEXTSTEP_SIGN_PASSWORD'
$previousPassword = [System.Environment]::GetEnvironmentVariable($environmentName, 'Process')
try {
    [System.Environment]::SetEnvironmentVariable($environmentName, $password, 'Process')
    $null = & $java -jar $signerPath sign `
        --ks $keystore `
        --ks-key-alias next-step `
        --ks-pass "env:$environmentName" `
        --key-pass "env:$environmentName" `
        --min-sdk-version 26 `
        --out $outputPath `
        $unsignedPath 2>&1
    if ($LASTEXITCODE -ne 0) {
        if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }
        Stop-Signing 'APK 签名失败；未显示密钥或密码信息。'
    }

    $verification = & $java -jar $signerPath verify --verbose --print-certs --min-sdk-version 26 $outputPath 2>&1
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
        Stop-Signing '签名校验失败；已删除未通过校验的 APK。'
    }
    $verificationText = $verification -join "`n"
    if ($verificationText -notmatch [regex]::Escape($certificateSha256) -or
        $verificationText -notmatch 'Verified using v2 scheme[^\r\n]*: true' -or
        $verificationText -notmatch 'Verified using v3 scheme[^\r\n]*: true') {
        Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
        Stop-Signing 'APK 签名未匹配既有发布证书或 v2/v3 校验未通过；已删除该 APK。'
    }

    Write-Output "签名并验证完成：$outputPath"
} finally {
    [System.Environment]::SetEnvironmentVariable($environmentName, $previousPassword, 'Process')
    $password = $null
    $passwordBytes = $null
    $protectedBytes = $null
}
