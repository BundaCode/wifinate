@echo off
setlocal
title Batalkan Wifinate otomatis saat Windows menyala
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Wifinate.lnk"
if exist "%LINK%" (
  del "%LINK%"
  echo.
  echo  [OK] Wifinate tidak lagi berjalan otomatis saat Windows dinyalakan.
) else (
  echo.
  echo  Wifinate memang belum dipasang di Startup.
)
echo.
pause
