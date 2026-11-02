@echo off
taskkill /f /im agente-impresion.exe >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AgenteImpresion.vbs" >nul 2>&1
rmdir /s /q "%LOCALAPPDATA%\AgenteImpresion" >nul 2>&1
echo Agente desinstalado.
pause
