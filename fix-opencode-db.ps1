# ============================================================================
#  Fix: reconstruir la BD de OpenCode (esquema roto: "no such column: replacement_seq")
#  EJECUTAR COMO ADMINISTRADOR.
#  Seguro: la auth de ChatGPT Pro vive en auth.json (no se toca). Se respalda la BD.
# ============================================================================
$ErrorActionPreference = 'Stop'
$svc      = 'openailocalproxy.exe'
$dataDir  = 'C:\Users\Usuario\.local\share\opencode'
$db       = Join-Path $dataDir 'opencode.db'
$envFile  = 'C:\Users\Usuario\Documents\agentCli\.env'
$stamp    = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir= Join-Path $dataDir "db-backup-$stamp"

function Step($m){ Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# --- Comprobar elevación ---
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "ERROR: abre PowerShell COMO ADMINISTRADOR y vuelve a ejecutar." -ForegroundColor Red
  exit 1
}

Step "1) Detener el servicio del proxy ($svc)"
Stop-Service -Name $svc -Force
(Get-Service -Name $svc).WaitForStatus('Stopped','00:00:30')
Write-Host "Servicio: $((Get-Service -Name $svc).Status)"

# El bot sigue sondeando cada 30s. Si le entra un correo mientras la BD se
# reconstruye, gasta sus 3 reintentos contra un proxy caido y el certificado
# termina escalado como error. Lo pausamos aqui; el paso 7 lo reanuda.
Step "1b) Pausar el bot de certificados mientras dura el arreglo"
docker pause bot-emision-certificados 2>$null
Write-Host "  bot pausado (el paso 7 lo reanuda)"

Step "2) Detener TODOS los procesos opencode (liberar lock de la BD)"
Get-Process -Name opencode -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
Write-Host "opencode restantes: $((Get-Process -Name opencode -ErrorAction SilentlyContinue | Measure-Object).Count)"

Step "3) Respaldar la BD actual en $backupDir"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Get-ChildItem $dataDir -Filter 'opencode.db*' -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item $_.FullName -Destination $backupDir -Force
  Write-Host "  respaldado: $($_.Name)"
}

Step "4) Borrar opencode.db + WAL (-shm, -wal)"
foreach ($f in @('opencode.db','opencode.db-shm','opencode.db-wal')) {
  $p = Join-Path $dataDir $f
  if (Test-Path $p) { Remove-Item $p -Force; Write-Host "  borrado: $f" }
}

Step "5) Arrancar el servicio (recreara opencode serve + BD nueva con el esquema correcto)"
Start-Service -Name $svc
Write-Host "Esperando a que el proxy (:3000) y opencode (:4096) esten arriba..."
$up = $false
for ($i=0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  $p3000 = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
  $p4096 = Get-NetTCPConnection -LocalPort 4096 -State Listen -ErrorAction SilentlyContinue
  if ($p3000 -and $p4096) { $up = $true; Write-Host "  Arriba tras $($i+1)s"; break }
}
if (-not $up) { Write-Host "AVISO: los puertos no subieron en 60s; revisa el daemon log." -ForegroundColor Yellow }

Step "6) VERIFICACION: peticion de prueba real al proxy (modelo gpt-5.6-terra-fast, como el bot)"
$secret = (Select-String -Path $envFile -Pattern '^\s*API_SECRET\s*=' -ErrorAction SilentlyContinue |
           Select-Object -First 1).Line -replace '^\s*API_SECRET\s*=\s*',''
$secret = $secret.Trim().Trim('"').Trim("'")
$headers = @{ 'Content-Type' = 'application/json' }
if ($secret) { $headers['Authorization'] = "Bearer $secret" }
$body = @{ model='gpt-5.6-terra-fast'; messages=@(@{role='user'; content='Responde solo: OK'}); max_tokens=5; temperature=0 } | ConvertTo-Json -Depth 5
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:3000/v1/chat/completions' -Method POST -Headers $headers -Body $body -TimeoutSec 90 -UseBasicParsing
  $txt = ($r.Content | ConvertFrom-Json).choices[0].message.content
  Write-Host "  HTTP $($r.StatusCode)" -ForegroundColor Green
  Write-Host "  Respuesta del modelo: '$txt'"
  $ok = $true
} catch {
  Write-Host "  FALLO la verificacion: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.Exception.Response) {
    $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Host "  Cuerpo: $($sr.ReadToEnd())"
  }
  $ok = $false
}

Step "7) Reanudar el bot (Docker)"
docker unpause bot-emision-certificados 2>$null

Write-Host ""
if ($ok) {
  Write-Host "RESULTADO: ARREGLADO. El proxy respondio 200 con gpt-5.6-terra-fast. Bot reanudado." -ForegroundColor Green
  Write-Host "Respaldo de la BD vieja en: $backupDir"
} else {
  Write-Host "RESULTADO: la BD nueva NO resolvio. Siguiente paso: actualizar OpenCode." -ForegroundColor Yellow
  Write-Host "  Ejecuta:  opencode upgrade   (y repite este script)."
  Write-Host "  Respaldo de la BD vieja en: $backupDir"
}
