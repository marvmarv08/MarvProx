@echo off
cd /d "%~dp0"
"%~dp0Proxy.exe" --connection-test --upstream www.growtopia1.com --timeout 120
