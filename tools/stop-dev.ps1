$state = Join-Path $PSScriptRoot '.dev'
foreach ($name in @('api', 'ui')) {
  $pidFile = Join-Path $state "$name.pid"
  if (Test-Path $pidFile) {
    $processId = [int](Get-Content $pidFile)
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) { Stop-Process -Id $processId -Force; Write-Output "$name detenido" }
    Remove-Item -LiteralPath $pidFile
  }
}
