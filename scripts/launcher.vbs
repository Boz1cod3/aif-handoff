Set objShell = CreateObject("WScript.Shell")
strPath = "powershell.exe -ExecutionPolicy Bypass -NoProfile -File ""d:\ANTIGRAVITY\aif-handoff_antigravity\scripts\launcher.ps1"""
objShell.Run strPath, 0, False
