import argparse
import csv
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Validate and summarize labels.csv")
    parser.add_argument(
        "--labels",
        default="tests/videos/labels.csv",
        help="Path to labels.csv",
    )
    args = parser.parse_args()

    labels_path = Path(args.labels)
    if not labels_path.exists():
        raise FileNotFoundError(f"labels file not found: {labels_path}")

    total = 0
    pos = 0
    neg = 0
    empty = 0
    bad = []

    with labels_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total += 1
            label = (row.get("label") or "").strip()
            if label == "":
                empty += 1
                continue
            if label == "1":
                pos += 1
            elif label == "0":
                neg += 1
            else:
                bad.append((row.get("segment_index", ""), label))

    print("=== Label Summary ===")
    print(f"file: {labels_path}")
    print(f"total_rows: {total}")
    print(f"positive(1): {pos}")
    print(f"negative(0): {neg}")
    print(f"empty: {empty}")
    if bad:
        print(f"invalid_labels: {len(bad)}")
        for seg_idx, label in bad[:10]:
            print(f"  segment {seg_idx}: {label}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()

