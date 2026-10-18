$ErrorActionPreference = 'Stop'
foreach ($target in @(@{Name='API'; Url='http://127.0.0.1:3000/'}, @{Name='UI'; Url='http://127.0.0.1:8080/'})) {
  try {
    $response = Invoke-WebRequest -Uri $target.Url -TimeoutSec 3
    Write-Output "$($target.Name) OK - $($target.Url) ($($response.StatusCode))"
  } catch {
    Write-Output "$($target.Name) NO DISPONIBLE - $($target.Url)"
  }
}
