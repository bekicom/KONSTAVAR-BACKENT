@echo off
setlocal

set "ROOT=%~dp0"
set "MONGOD_EXE=%ROOT%node_modules\.cache\mongodb-memory-server\mongod-x64-win32-8.2.1.exe"
set "DATA_DIR=%ROOT%.mongo-data"

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

start "KONSTAVAR MongoDB" "%MONGOD_EXE%" --dbpath "%DATA_DIR%" --port 27017 --bind_ip 127.0.0.1 --storageEngine wiredTiger

timeout /t 6 /nobreak >nul

start "KONSTAVAR API" cmd /k "cd /d \"%ROOT%\" && set MONGO_URI=mongodb://127.0.0.1:27017/konstavar && node server.js"

echo.
echo MongoDB and API were started in separate windows.
echo Compass connection string: mongodb://127.0.0.1:27017
echo Backend: http://127.0.0.1:8090
echo.

