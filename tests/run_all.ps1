$ErrorActionPreference = "Stop"

Write-Host "== Offline matcher test =="
node .\tests\test_matcher_offline.js

Write-Host ""
Write-Host "== Threshold sweep =="
node .\tests\test_threshold_sweep.js

Write-Host ""
Write-Host "== Tune from labeled features =="
node .\tests\tune_from_labels.js

Write-Host ""
Write-Host "== Label summary =="
& "D:\conda_env\content_assistant\python.exe" .\tests\check_labels.py --labels .\tests\videos\labels.csv

Write-Host ""
Write-Host "All test scripts completed."
