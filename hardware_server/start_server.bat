@echo off
cd /d "%~dp0"
echo Starting Hardware Server...
python -m pip install -r requirements.txt
python main.py
pause
