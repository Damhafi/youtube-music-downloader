@echo off
title YouTube Music Downloader
color 0D

echo.
echo  ============================================================
echo    🎵  YouTube Music Downloader — Inicializando...
echo  ============================================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo  ❌ Python não encontrado! Instale em https://python.org
    pause
    exit /b
)

:: Check/install dependencies
echo  📦 Verificando dependências...
python -m pip install --quiet flask flask-cors yt-dlp >nul 2>&1

:: Check FFmpeg
where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ⚠️  FFmpeg não encontrado no PATH.
    echo     O download de MP3 pode não funcionar sem FFmpeg.
    echo     Baixe em: https://ffmpeg.org/download.html
    echo     Ou coloque ffmpeg.exe na pasta server\ffmpeg\
    echo.
)

echo.
echo  ✅ Dependências OK!
echo.
echo  🚀 Iniciando servidor...
echo  📍 Dashboard: http://localhost:5000
echo  📍 Extensão Chrome: Carregue a pasta "extension" em chrome://extensions
echo.
echo  ============================================================
echo    Pressione Ctrl+C para parar o servidor
echo  ============================================================
echo.

:: Start the server
cd /d "%~dp0server"
python app.py

pause
