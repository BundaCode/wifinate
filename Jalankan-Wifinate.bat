@echo off
setlocal
title Wifinate
rem ============================================================
rem  Jalankan Wifinate (klik dua kali file ini).
rem  - Memasang dependensi otomatis jika belum ada (sekali saja)
rem  - Membuka browser ke http://localhost:8080
rem  - Menyala ulang otomatis jika berhenti (mis. setelah pulihkan backup)
rem  Tutup jendela ini untuk menghentikan Wifinate.
rem  Parameter /diam = tidak membuka browser (dipakai saat startup Windows).
rem ============================================================

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [X] Node.js belum terpasang.
  echo      Unduh versi LTS di https://nodejs.org lalu pasang, kemudian buka file ini lagi.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo  Memasang dependensi untuk pertama kali, mohon tunggu 1-3 menit...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  [X] npm install gagal. Foto/salin pesan error di atas lalu tanyakan.
    echo.
    pause
    exit /b 1
  )
)

if /i not "%~1"=="/diam" (
  rem Buka browser setelah Wifinate siap, dicek di latar belakang.
  start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 180;$i++){try{Invoke-WebRequest -UseBasicParsing http://localhost:8080/api/health -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:8080'; break}catch{Start-Sleep -Seconds 2}}"
)

:jalan
echo.
echo  ==========================================================
echo   Wifinate berjalan. Buka di browser: http://localhost:8080
echo   JANGAN tutup jendela ini selama Wifinate dipakai.
echo  ==========================================================
echo.
node scripts\start.mjs
set KODE=%errorlevel%
echo.
echo  Wifinate berhenti (kode %KODE%). Menyalakan ulang dalam 5 detik...
echo  Tutup jendela ini jika memang ingin menghentikan Wifinate.
timeout /t 5 /nobreak >nul
goto jalan
