# Backend development setup

This file explains how to create a Python virtual environment and install dependencies for the backend on Windows (PowerShell).

Run these commands from the repository root (`MES-Capstone-Team`):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
```

To run the API locally (development):

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

If your editor shows `Import "fastapi" could not be resolved`, make sure you have selected the workspace Python interpreter that points to the `.venv` created above and that the environment is activated.

If you prefer conda, create and activate a conda env and then `pip install -r requirements.txt`.
