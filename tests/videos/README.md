Place your long recording here:

- `tests/videos/raw/session_01.mp4`

Then split it every 5 seconds:

```powershell
& "D:\conda_env\content_assistant\python.exe" .\tests\video_splitter.py --input .\tests\videos\raw\session_01.mp4 --segment-seconds 5
```

This will generate:

- clips in `tests/videos/segments/`
- label template in `tests/videos/labels.csv`

Label format:

- `label=1` means target gesture
- `label=0` means non-target gesture

