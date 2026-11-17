@echo off
chcp 65001 > nul
set "PATH=C:\Program Files\nodejs;%PATH%"

echo ===============================================================================
echo        🎨 KHỞI ĐỘNG GIAO DIỆN KIỂM THỬ AUTOTEST STUDIO CHO TESTER
echo ===============================================================================
echo.
echo [i] Đang khởi động máy chủ giao diện tại http://localhost:5000 ...
echo [i] Trình duyệt web sẽ tự động mở trong giây lát...
echo.

start "" "http://localhost:5000"
node node_modules\tsx\dist\cli.mjs src\ui-server.ts

pause
