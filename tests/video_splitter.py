import argparse
import csv
import json
import math
import subprocess
from pathlib import Path


def run(cmd, capture_output=True):
    return subprocess.run(
        cmd,
        check=True,
        capture_output=capture_output,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )


def probe_duration(video_path: Path) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(video_path),
    ]
    out = run(cmd, capture_output=True)
    data = json.loads(out.stdout)
    return float(data["format"]["duration"])


def split_video(video_path: Path, out_dir: Path, segment_seconds: int):
    duration = probe_duration(video_path)
    total_segments = int(math.ceil(duration / segment_seconds))
    out_dir.mkdir(parents=True, exist_ok=True)
    segments = []
    for idx in range(total_segments):
        start = idx * segment_seconds
        seg_len = min(segment_seconds, duration - start)
        seg_name = f"segment_{idx + 1:03d}.mp4"
        seg_path = out_dir / seg_name
        cmd = [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(video_path),
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{seg_len:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "20",
            "-an",
            str(seg_path),
        ]
        run(cmd, capture_output=False)
        segments.append((idx + 1, seg_name, start, seg_len))
    return duration, segments


def write_labels_template(csv_path: Path, segments):
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["segment_index", "filename", "label", "notes"])
        for seg_idx, filename, _, _ in segments:
            writer.writerow([seg_idx, filename, "", ""])


def main():
    parser = argparse.ArgumentParser(
        description="Split one long capture into fixed-length clips and generate a labels template."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Input video path, e.g. tests/videos/raw/session_01.mp4",
    )
    parser.add_argument(
        "--segment-seconds",
        type=int,
        default=5,
        help="Segment length in seconds. Default: 5",
    )
    parser.add_argument(
        "--out-dir",
        default="tests/videos/segments",
        help="Output directory for clips.",
    )
    parser.add_argument(
        "--labels",
        default="tests/videos/labels.csv",
        help="CSV template output path.",
    )
    args = parser.parse_args()

    video_path = Path(args.input)
    if not video_path.exists():
        raise FileNotFoundError(f"Input video not found: {video_path}")

    out_dir = Path(args.out_dir)
    duration, segments = split_video(video_path, out_dir, args.segment_seconds)
    write_labels_template(Path(args.labels), segments)

    print("=== Video Split Complete ===")
    print(f"input: {video_path}")
    print(f"duration_sec: {duration:.2f}")
    print(f"segment_seconds: {args.segment_seconds}")
    print(f"segments: {len(segments)}")
    print(f"out_dir: {out_dir}")
    print(f"labels_template: {args.labels}")


if __name__ == "__main__":
    main()
