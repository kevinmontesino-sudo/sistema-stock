@echo off
chcp 65001 >nul
setlocal
title Instalar agente de impresion de etiquetas
set "AQUI=%~dp0"
set "DEST=%LOCALAPPDATA%\AgenteImpresion"
set "ARRANQUE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo Instalando el agente de impresion en "%DEST%" ...
taskkill /f /im agente-impresion.exe >nul 2>&1
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%AQUI%node.exe" "%DEST%\agente-impresion.exe" >nul || goto error
copy /y "%AQUI%agente.mjs" "%DEST%\" >nul || goto error
copy /y "%AQUI%imprimir-raw.ps1" "%DEST%\" >nul || goto error

> "%ARRANQUE%\AgenteImpresion.vbs" echo Set sh = CreateObject("WScript.Shell")
>> "%ARRANQUE%\AgenteImpresion.vbs" echo sh.Run """%DEST%\agente-impresion.exe"" ""%DEST%\agente.mjs""", 0, False
wscript.exe "%ARRANQUE%\AgenteImpresion.vbs"

timeout /t 3 /nobreak >nul
echo.
echo Estado del agente e impresoras de esta PC:
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9101/).Content } catch { Write-Host 'EL AGENTE NO RESPONDE' }"
echo.
echo Si arriba aparece tu impresora de etiquetas, esta todo listo. Se abre solo cada vez que prendes la PC.
pause
exit /b 0

:error
echo.
echo Algo fallo al copiar los archivos. Saca una foto de esta pantalla y mandala.
pause
exit /b 1
