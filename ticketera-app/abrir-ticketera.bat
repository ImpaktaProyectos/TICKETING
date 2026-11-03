@echo off
REM ============================================================
REM   TIXFAST - TPV con IMPRESION DIRECTA (sin ventana de imprimir)
REM   Usa un perfil de Chrome PROPIO para el TPV:
REM   - funciona aunque tengas otro Chrome abierto
REM   - no le afectan ajustes de impresion guardados en tu Chrome normal
REM   - el tamano de papel lo toma de la impresora (Preferencias de impresion)
REM ============================================================
set URL=https://somostixfast.vercel.app
set PERFIL=%LOCALAPPDATA%\TIXFAST-TPV

set FLAGS=--user-data-dir="%PERFIL%" --kiosk-printing --no-first-run --no-default-browser-check --app=%URL%

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" %FLAGS%
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" %FLAGS%
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
  start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" %FLAGS%
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" %FLAGS%
) else (
  echo No se encontro Chrome ni Edge. Instala Google Chrome y vuelve a intentarlo.
  pause
)
