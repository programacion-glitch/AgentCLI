<#
.SYNOPSIS
    Instalador del OpenAI Local Proxy desde cero.

.DESCRIPTION
    Este script configura todo lo necesario para que el proxy funcione
    en un equipo nuevo con Windows. Ejecutar como Administrador.

.EXAMPLE
    .\setup.ps1
#>

param(
    [string]$InstallDir = "$env:USERPROFILE\Documents\AgentAI",
    [switch]$SkipService
)

# -- Colores y helpers --
function Write-Step   { param($msg) Write-Host "`n[$script:step] $msg" -ForegroundColor Cyan;   $script:step++ }
function Write-Ok     { param($msg) Write-Host ("  [OK] " + $msg) -ForegroundColor Green }
function Write-Warn   { param($msg) Write-Host ("  [!!] " + $msg) -ForegroundColor Yellow }
function Write-Fail   { param($msg) Write-Host ("  [XX] " + $msg) -ForegroundColor Red }
function Write-Info   { param($msg) Write-Host ("    " + $msg) -ForegroundColor Gray }

$script:step = 1
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================================" -ForegroundColor Magenta
Write-Host "       OpenAI Local Proxy -- Instalador v1.0            " -ForegroundColor Magenta
Write-Host "========================================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Directorio de instalacion: $InstallDir" -ForegroundColor Gray
Write-Host ""

# 1. Verificar permisos de administrador
Write-Step "Verificando permisos de administrador..."

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $SkipService) {
    Write-Warn "No se detectaron permisos de administrador."
    Write-Info "El servicio de Windows requiere permisos de admin."
    Write-Info "Si NO necesitas el servicio, ejecuta: .\setup.ps1 -SkipService"
    Write-Host ""
    $continue = Read-Host "  Continuar de todos modos? (s/N)"
    if ($continue -ne "s" -and $continue -ne "S") {
        Write-Host "`n  Cancelado. Ejecuta PowerShell como Administrador." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Ok "Permisos verificados"
}

# 2. Verificar / instalar Node.js
Write-Step "Verificando Node.js..."

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVersion = & node --version 2>$null
    Write-Ok "Node.js $nodeVersion encontrado"

    $major = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($major -lt 18) {
        Write-Fail "Se requiere Node.js 18 o superior (tienes $nodeVersion)"
        Write-Info "Descarga la version LTS desde: https://nodejs.org/"
        exit 1
    }
} else {
    Write-Fail "Node.js no esta instalado"
    Write-Host ""
    Write-Host "  Node.js es necesario para ejecutar el proxy." -ForegroundColor Yellow
    Write-Host "  Descargalo desde: https://nodejs.org/ (version LTS recomendada)" -ForegroundColor Yellow
    Write-Host ""

    $installNode = Read-Host "  Intentar instalar Node.js automaticamente con winget? (s/N)"
    if ($installNode -eq "s" -or $installNode -eq "S") {
        try {
            Write-Info "Instalando Node.js LTS con winget..."
            winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
            $nodeVersion = & node --version 2>$null
            Write-Ok "Node.js $nodeVersion instalado correctamente"
        } catch {
            Write-Fail "No se pudo instalar Node.js automaticamente"
            Write-Info "Instalalo manualmente desde https://nodejs.org/ y vuelve a ejecutar este script"
            exit 1
        }
    } else {
        Write-Info "Instala Node.js manualmente y vuelve a ejecutar este script."
        exit 1
    }
}

$npmVersion = & npm --version 2>$null
Write-Ok "npm v$npmVersion"

# 3. Verificar / instalar OpenCode CLI
Write-Step "Verificando OpenCode CLI..."

$opencodeCmd = Get-Command opencode -ErrorAction SilentlyContinue
if ($opencodeCmd) {
    $ocVersion = & opencode --version 2>$null
    Write-Ok "OpenCode CLI v$ocVersion encontrado"
} else {
    Write-Warn "OpenCode CLI no esta instalado. Instalando..."
    try {
        npm install -g opencode-ai
        $ocVersion = & opencode --version 2>$null
        Write-Ok "OpenCode CLI v$ocVersion instalado"
    } catch {
        Write-Fail "No se pudo instalar opencode-ai"
        Write-Info "Intenta manualmente: npm install -g opencode-ai"
        exit 1
    }
}

# 4. Preparar directorio del proyecto
Write-Step "Preparando directorio del proyecto..."

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Ok "Directorio creado: $InstallDir"
} else {
    Write-Ok "Directorio ya existe: $InstallDir"
}

$requiredFiles = @("package.json", "tsconfig.json", "src\index.ts", "src\server.ts", "src\opencode.ts", "src\notifier.ts", "src\types.ts")
$missingFiles = @()
foreach ($file in $requiredFiles) {
    if (-not (Test-Path (Join-Path $InstallDir $file))) {
        $missingFiles += $file
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Fail "Faltan archivos del proyecto en $InstallDir :"
    foreach ($f in $missingFiles) {
        Write-Info "  - $f"
    }
    Write-Host ""
    Write-Info "Copia los archivos fuente del proyecto a $InstallDir antes de continuar."
    Write-Info "Archivos necesarios: package.json, tsconfig.json, src/*.ts, .env.example"
    exit 1
}

Write-Ok "Archivos del proyecto verificados"

# 5. Instalar dependencias
Write-Step "Instalando dependencias (npm install)..."

Push-Location $InstallDir
$null = cmd /c "npm install 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Error al instalar dependencias. Ejecuta 'npm install' manualmente para ver el error."
    Pop-Location
    exit 1
}
Write-Ok "Dependencias instaladas"

# 6. Compilar TypeScript
Write-Step "Compilando TypeScript..."

$null = cmd /c "npm run build 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Error de compilacion. Ejecuta 'npm run build' manualmente para ver los errores."
    Pop-Location
    exit 1
}
Write-Ok "Compilacion exitosa -> dist/"

# 7. Configurar archivo .env
Write-Step "Configurando archivo .env..."

$envFile    = Join-Path $InstallDir ".env"
$envExample = Join-Path $InstallDir ".env.example"

if (Test-Path $envFile) {
    Write-Ok "Archivo .env ya existe (no se sobreescribe)"
} elseif (Test-Path $envExample) {
    Copy-Item $envExample $envFile
    Write-Ok "Archivo .env creado desde .env.example"
    Write-Warn "IMPORTANTE: Edita el archivo .env para configurar:"
    Write-Info "  - SMTP_HOST, SMTP_USER, SMTP_PASS -> correo de alertas"
    Write-Info "  - DEFAULT_MODEL -> modelo de IA (dejar vacio para auto-detectar)"
    Write-Info "  - MONITOR_INTERVAL_MINUTES -> (Nuevo) monitoreo proactivo cada X min"
    Write-Info "  - API_SECRET -> token de proteccion (opcional)"
} else {
    Write-Warn "No se encontro .env ni .env.example"
    Write-Info "Crea un archivo .env manualmente. Ver README.md para referencia."
}

# 8. Autenticacion de OpenCode
Write-Step "Verificando autenticacion de OpenCode..."

$authFile = Join-Path $env:USERPROFILE ".local\share\opencode\auth.json"
if (Test-Path $authFile) {
    Write-Ok "Credenciales de OpenCode encontradas"
    Write-Info "Archivo: $authFile"
} else {
    Write-Warn "OpenCode no esta autenticado con ChatGPT Pro"
    Write-Host ""
    Write-Host "  Para autenticar, sigue estos pasos:" -ForegroundColor Yellow
    Write-Host "  1. Ejecuta: opencode" -ForegroundColor White
    Write-Host "  2. Dentro del TUI escribe: /connect" -ForegroundColor White
    Write-Host "  3. Selecciona: OpenAI -> ChatGPT Plus/Pro" -ForegroundColor White
    Write-Host "  4. Completa el login en el navegador que se abre" -ForegroundColor White
    Write-Host "  5. Vuelve a la terminal y cierra con Ctrl+C" -ForegroundColor White
    Write-Host ""

    $authNow = Read-Host "  Abrir opencode ahora para autenticarte? (s/N)"
    if ($authNow -eq "s" -or $authNow -eq "S") {
        Write-Info "Abriendo OpenCode... Sigue las instrucciones arriba."
        Write-Info "(Cierra OpenCode con Ctrl+C cuando termines)"
        Write-Host ""
        & opencode
        Write-Host ""

        if (Test-Path $authFile) {
            Write-Ok "Autenticacion completada"
        } else {
            Write-Warn "No se detectaron credenciales despues de cerrar OpenCode"
            Write-Info "Puedes autenticarte despues ejecutando: opencode -> /connect"
        }
    } else {
        Write-Info "Puedes autenticarte despues ejecutando: opencode -> /connect"
    }
}

# 9. Prueba rapida del proxy
Write-Step "Probando que el proxy arranca correctamente..."

Write-Info "Iniciando proxy en segundo plano (8 segundos)..."
$proxyJob = Start-Job -ScriptBlock {
    Set-Location $using:InstallDir
    & node dist/index.js 2>&1
}

Start-Sleep -Seconds 8

try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 5 -ErrorAction Stop
    if ($health.status -eq "ok") {
        Write-Ok "Proxy responde correctamente"
        Write-Info "OpenCode: $($health.opencode)"
        Write-Info "Modelo: $($health.default_model)"
    }
} catch {
    Write-Warn "El proxy no respondio (puede ser normal si OpenCode no esta autenticado)"
    Write-Info "Puedes probarlo manualmente despues con: npm start"
}

Stop-Job $proxyJob -ErrorAction SilentlyContinue
Remove-Job $proxyJob -Force -ErrorAction SilentlyContinue

# 10. Instalar servicio de Windows (opcional)
if (-not $SkipService) {
    Write-Step "Instalando servicio de Windows..."

    if (-not $isAdmin) {
        Write-Warn "Se requieren permisos de administrador para instalar el servicio"
        Write-Info "Ejecuta despues: npm run service:install (como admin)"
    } else {
        $installService = Read-Host "  Instalar como servicio de Windows (arranca automaticamente)? (S/n)"
        if ($installService -ne "n" -and $installService -ne "N") {
            try {
                node service-install.js 2>&1
                Write-Ok "Servicio instalado"
            } catch {
                Write-Fail "Error al instalar el servicio: $_"
                Write-Info "Puedes intentarlo despues: npm run service:install"
            }
        } else {
            Write-Info "Servicio no instalado. Para iniciarlo manualmente: npm start"
            Write-Info "Para instalar el servicio despues: npm run service:install"
        }
    }
} else {
    Write-Step "Instalacion del servicio omitida (-SkipService)"
    Write-Info "Para instalar el servicio despues: npm run service:install (como admin)"
}

Pop-Location

# Resumen final
Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "            Instalacion completada                      " -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Directorio: $InstallDir" -ForegroundColor White
Write-Host ""
Write-Host "  Comandos utiles:" -ForegroundColor White
Write-Host "    npm start                  -> Iniciar proxy manualmente" -ForegroundColor Gray
Write-Host "    npm run service:install    -> Registrar como servicio Windows" -ForegroundColor Gray
Write-Host "    npm run service:stop       -> Detener servicio" -ForegroundColor Gray
Write-Host "    npm run service:uninstall  -> Eliminar servicio" -ForegroundColor Gray
Write-Host ""
Write-Host "  Endpoint del proxy:" -ForegroundColor White
Write-Host "    POST http://localhost:3000/v1/chat/completions" -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path $authFile)) {
    Write-Host "  [!!] PENDIENTE: Autenticar OpenCode con ChatGPT Pro" -ForegroundColor Yellow
    Write-Host "    Ejecuta: opencode -> /connect -> OpenAI -> ChatGPT Plus/Pro" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "  Para mas detalles consulta: README.md y API_MANUAL.md" -ForegroundColor Gray
Write-Host ""
