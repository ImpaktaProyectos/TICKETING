@echo off
REM ============================================================
REM   TICKETERA - abre la app con IMPRESION DIRECTA (sin dialogo)
REM   >>> EDITA SOLO LA LINEA DE ABAJO con tu direccion de Vercel <<<
REM ============================================================
set URL=https://TU-DIRECCION.vercel.app

set FLAGS=--kiosk-printing --app=%URL%

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" %FLAGS%
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" %FLAGS%
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" %FLAGS%
) else (
  echo No se encontro Chrome ni Edge. Instala Google Chrome y vuelve a intentarlo.
  pause
)
