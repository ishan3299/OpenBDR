@echo off
REM OpenBDR Native Host Wrapper for Windows
REM Ensures the Python script is executed with the correct interpreter
REM -u flag ensures unbuffered stdout/stderr for reliable communication
python -u "%~dp0openbdr_host.py" %*
