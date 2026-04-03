$ErrorActionPreference = "Stop"

$py = "D:\conda_env\content_assistant\python.exe"

Write-Host "== Extract stage summary (positive) =="
& $py .\tests\extract_stage_summary_mediapipe.py `
  --segments-dir .\tests\videos\segments `
  --labels .\tests\videos\labels.csv `
  --out .\tests\videos\features\stage_summary_pos.json

Write-Host ""
Write-Host "== Extract stage summary (negative normal) =="
& $py .\tests\extract_stage_summary_mediapipe.py `
  --segments-dir .\tests\videos\segments_neg_normal `
  --labels .\tests\videos\labels_neg_normal.csv `
  --out .\tests\videos\features\stage_summary_neg_normal.json

Write-Host ""
Write-Host "== Extract stage summary (negative hard) =="
& $py .\tests\extract_stage_summary_mediapipe.py `
  --segments-dir .\tests\videos\segments_neg_hard `
  --labels .\tests\videos\labels_neg_hard.csv `
  --out .\tests\videos\features\stage_summary_neg_hard.json

Write-Host ""
Write-Host "== Two-stage offline evaluation =="
node .\tests\eval_two_stage_from_labels.js
