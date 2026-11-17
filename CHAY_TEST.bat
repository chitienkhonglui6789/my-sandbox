@echo off
chcp 65001 > nul
set "PATH=C:\Program Files\nodejs;%PATH%"

echo ===============================================================================
echo      HỆ THỐNG KIỂM THỬ WEB TỰ ĐỘNG BẰNG TIẾNG VIỆT - AUTOTEST ENGINE
echo ===============================================================================
echo.

if exist "kich_ban.txt" (
    echo [i] Đang đọc kịch bản từ file kich_ban.txt...
    echo -------------------------------------------------------------------------------
    node node_modules\tsx\dist\cli.mjs src\cli.ts --file kich_ban.txt
) else (
    echo [i] Không tìm thấy file kich_ban.txt. Đang chạy bộ kiểm thử mẫu cục bộ...
    echo -------------------------------------------------------------------------------
    node node_modules\tsx\dist\cli.mjs src\cli.ts
)

echo.
echo ===============================================================================
echo [x] Kết thúc kiểm thử. Ảnh chụp bằng chứng đã được lưu trong thư mục "output".
echo ===============================================================================
echo.
pause
