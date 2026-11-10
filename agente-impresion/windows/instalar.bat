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

echo Esperando que arranque (puede tardar hasta 30 segundos en una PC lenta)...
echo.
echo Estado del agente e impresoras de esta PC:
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://127.0.0.1:9101/).Content; $ok=$true; break } catch { Start-Sleep -Seconds 1 } }; if(-not $ok){ Write-Host ('EL AGENTE NO RESPONDE. Saca una foto de esta pantalla y del archivo ' + $env:LOCALAPPDATA + '\AgenteImpresion\agente.log') }"
echo.
echo Si arriba dice "funcionando" y aparecen tus impresoras (la de tickets con TM-T20 y la de etiquetas con 410), esta todo listo. Se abre solo cada vez que prendes la PC.
pause
exit /b 0

:error
echo.
echo Algo fallo al copiar los archivos. Saca una foto de esta pantalla y mandala.
pause
exit /b 1
