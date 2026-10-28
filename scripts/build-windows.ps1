param(
  [ValidateSet('win-x64', 'win-arm64')][string]$Runtime = 'win-x64',
  [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not $SkipWebBuild) {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Shared reader build failed.' }
}
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$publish = Join-Path $PWD "build/windows/$Runtime"
if (Test-Path $publish) { Remove-Item -Recurse -Force $publish }
dotnet publish apps/windows/LeafReader.csproj -c Release -r $Runtime --self-contained true -o $publish -p:ContinuousIntegrationBuild=true
if ($LASTEXITCODE -ne 0) { throw 'Windows publish failed.' }
@"
页间 · Leaf Reader $version

打开 LeafReader.exe。请保留 web 文件夹和其他运行文件，完整解压后使用。
首次运行需要 Microsoft Edge WebView2 Runtime；Windows 11 通常已预装。
官方下载：https://developer.microsoft.com/microsoft-edge/webview2/

支持 TXT/PDF 导入、翻页、阅读设置、书签，以及 Azure 书本和进度同步。
在阅读空间填写自己的同步地址与连接码，或导入个人同步配置 JSON。
"@ | Set-Content -Encoding utf8 (Join-Path $publish '使用说明.txt')
New-Item -ItemType Directory -Force build/releases | Out-Null
$architecture = if ($Runtime -eq 'win-arm64') { 'ARM64' } else { 'x64' }
$zip = Join-Path $PWD "build/releases/页间-Windows-$architecture-$version.zip"
Compress-Archive -Path "$publish/*" -DestinationPath $zip -Force
Write-Host "Windows package: $zip"
