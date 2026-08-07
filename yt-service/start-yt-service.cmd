@echo off
REM Pembungkus yt-service untuk auto-start.
REM
REM Tugasnya tiga: menghidupkan kembali proses kalau mati, mencatat keluaran ke
REM berkas (service latar tidak punya konsol untuk dilihat), dan berhenti
REM permanen kalau kesalahannya jenis yang tidak akan membaik dengan diulang —
REM salah konfigurasi atau port sudah dipakai instance lain (kode keluar 2).

cd /d "%~dp0"
if not exist "logs" mkdir "logs"

:loop
REM Putar log kalau sudah lewat 5 MB, simpan satu generasi sebelumnya.
if exist "logs\yt-service.log" (
  for %%A in ("logs\yt-service.log") do (
    if %%~zA GTR 5242880 move /y "logs\yt-service.log" "logs\yt-service.prev.log" >nul 2>&1
  )
)

node src\index.js >> "logs\yt-service.log" 2>&1
set RC=%errorlevel%
if "%RC%"=="2" goto fatal

echo [wrapper] %date% %time% proses berhenti (kode %RC%), dinyalakan lagi dalam 5 detik >> "logs\yt-service.log"
timeout /t 5 /nobreak >nul
goto loop

:fatal
echo [wrapper] %date% %time% berhenti permanen (kode %RC%) - perbaiki .env lalu jalankan ulang task >> "logs\yt-service.log"
exit /b 2
