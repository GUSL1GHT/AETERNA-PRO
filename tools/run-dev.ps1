$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$state = Join-Path $PSScriptRoot '.dev'
New-Item -ItemType Directory -Force -Path $state | Out-Null
& (Join-Path $PSScriptRoot 'stop-dev.ps1')
$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $root 'backend/node_modules'))) {
  throw 'Instala primero las dependencias de backend (pnpm install --dir backend o npm install en backend).'
}
$env:PORT = '3000'
$api = Start-Process -FilePath $node -ArgumentList 'server-v11.js' -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $state 'api.log') -RedirectStandardError (Join-Path $state 'api-error.log')
Set-Content (Join-Path $state 'api.pid') $api.Id
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  try { $ready = (Invoke-RestMethod 'http://127.0.0.1:3000/' -TimeoutSec 2).ok; if ($ready) { break } } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ready) { throw 'La API no respondió. Consulta tools/.dev/api-error.log.' }
$env:UI_PORT = '8080'
$ui = Start-Process -FilePath $node -ArgumentList (Join-Path $PSScriptRoot 'static-server.js') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $state 'ui.log') -RedirectStandardError (Join-Path $state 'ui-error.log')
Set-Content (Join-Path $state 'ui.pid') $ui.Id
for ($i = 0; $i -lt 30; $i++) {
  try { $response = Invoke-WebRequest 'http://127.0.0.1:8080/' -TimeoutSec 2; if ($response.StatusCode -eq 200) { break } } catch { Start-Sleep -Milliseconds 500 }
}
if ($response.StatusCode -ne 200) { throw 'La UI no respondió. Consulta tools/.dev/ui-error.log.' }
Write-Output 'API OK / UI OK / listo para probar'
Write-Output 'API: http://127.0.0.1:3000/'
Write-Output 'UI: http://127.0.0.1:8080/'
Start-Process 'http://127.0.0.1:8080/'
