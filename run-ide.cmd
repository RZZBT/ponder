@echo off
rem Starts a sandbox IntelliJ IDEA with Ponder installed and examples\consumer open.
setlocal

if not "%JAVA_HOME%"=="" goto java_ok
for /d %%d in ("%USERPROFILE%\.jdks\jbr-25*" "%USERPROFILE%\.jdks\*25*") do if exist "%%~d\bin\javac.exe" set "JAVA_HOME=%%~d"
if "%JAVA_HOME%"=="" (
  echo JAVA_HOME is not set and no JDK 25 was found in %USERPROFILE%\.jdks
  exit /b 1
)
:java_ok

set "IDE=C:\Program Files\JetBrains\IntelliJ IDEA 2026.2.3"
set "LOCAL="
if exist "%IDE%\bin" set "LOCAL=-PplatformLocalPath=%IDE%"

call "%~dp0gradlew.bat" %LOCAL% :plugin:runIde
