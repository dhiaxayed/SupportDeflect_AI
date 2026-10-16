@echo off
REM Windows double-click wrapper for the existing native launcher and root virtual environment.
REM Service startup and shutdown belong to run_native.py; this wrapper returns nonzero when launching fails.
setlocal
title SupportDeflect AI - Demarrage local
REM Resolve execution relative to this launcher even when opened from another working directory.
pushd "%~dp0"
if errorlevel 1 goto directory_error

echo SupportDeflect AI - Demarrage du projet
echo.
REM Dependencies and the virtual environment must already exist; this script performs no installation.
if not exist ".venv\Scripts\python.exe" (
    echo Python manque : creez l'environnement .venv selon le README.
    goto failure
)

REM Forward caller options such as --check; unbuffered output keeps startup diagnostics visible.
".venv\Scripts\python.exe" -u "scripts\run_native.py" --open-browser %*
REM Capture the child status immediately, before any echo or cleanup command can replace it.
set "launch_result=%errorlevel%"
if not "%launch_result%"=="0" goto failure

popd
exit /b 0

REM Keep errors visible for double-click users and return a nonzero status after restoring the directory.
:failure
echo.
echo Le lancement a echoue. Consultez le message ci-dessus et le dossier logs.
pause
popd
exit /b 1

REM pushd failed, so there is no saved directory to pop on this path.
:directory_error
echo Impossible d'ouvrir le dossier du projet.
pause
exit /b 1
