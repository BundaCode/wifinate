@echo off
setlocal
title Pasang Wifinate otomatis saat Windows menyala
rem Membuat shortcut di folder Startup Windows supaya Wifinate
rem langsung berjalan (jendela diperkecil) setiap kali komputer dinyalakan.

cd /d "%~dp0"
set "TARGET=%~dp0Jalankan-Wifinate.bat"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Wifinate.lnk"

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK); $s.TargetPath=$env:TARGET; $s.Arguments='/diam'; $s.WorkingDirectory=(Split-Path $env:TARGET); $s.WindowStyle=7; $s.Description='Wifinate'; $s.Save()"

if exist "%LINK%" (
  echo.
  echo  [OK] Wifinate akan berjalan otomatis setiap kali Windows dinyalakan.
  echo       Jendelanya muncul dalam keadaan diperkecil di taskbar - jangan ditutup.
  echo.
  echo  Untuk membatalkan, klik dua kali: Hapus-Otomatis-Startup.bat
) else (
  echo.
  echo  [X] Gagal membuat shortcut di folder Startup.
)
echo.
pause
