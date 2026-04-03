import argparse
import csv
import json
from pathlib import Path

import cv2
import mediapipe as mp


def smooth(points, window=5):
    if not points:
        return []
    out = []
    half = window // 2
    for i in range(len(points)):
        start = max(0, i - half)
        end = min(len(points), i + half + 1)
        chunk = points[start:end]
        out.append(
            {
                "x": sum(p["x"] for p in chunk) / len(chunk),
                "y": sum(p["y"] for p in chunk) / len(chunk),
                "timestamp": points[i]["timestamp"],
            }
        )
    return out


def hand_label(handedness_entry):
    if handedness_entry is None:
        return None
    if hasattr(handedness_entry, "classification") and handedness_entry.classification:
        return handedness_entry.classification[0].label
    return None


def pick_anchor_hand(results):
    landmarks_list = results.multi_hand_landmarks or []
    handedness_list = results.multi_handedness or []
    if not landmarks_list:
        return None

    # Prefer right hand to match runtime endpoint/anchor behavior.
    for i, hand in enumerate(landmarks_list):
        label = hand_label(handedness_list[i]) if i < len(handedness_list) else None
        if label == "Right":
            return hand.landmark

    return landmarks_list[0].landmark


def extract_video(video_path: Path, min_hands: int = 2):
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_sec = frame_count / fps if fps > 0 else 0

    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        model_complexity=0,
        min_detection_confidence=0.65,
        min_tracking_confidence=0.4,
    )

    points = []
    detected_frames = 0
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb)
        if results.multi_hand_landmarks and len(results.multi_hand_landmarks) >= min_hands:
            hand = pick_anchor_hand(results)
            if hand is None:
                idx += 1
                continue
            ax = (hand[8].x + hand[12].x) / 2
            ay = (hand[8].y + hand[12].y) / 2
            detected_frames += 1
            points.append(
                {
                    "x": float(ax),
                    "y": float(ay),
                    "timestamp": int((idx / fps) * 1000),
                }
            )
        idx += 1

    hands.close()
    cap.release()

    return {
        "frame_count": frame_count,
        "fps": fps,
        "duration_sec": duration_sec,
        "detected_frames": detected_frames,
        "detection_ratio": (detected_frames / frame_count) if frame_count else 0,
        "raw_points": points,
        "smoothed_points": smooth(points, window=5),
    }


def main():
    parser = argparse.ArgumentParser(description="Extract index fingertip trajectories from labeled segments.")
    parser.add_argument("--segments-dir", default="tests/videos/segments")
    parser.add_argument("--labels", default="tests/videos/labels.csv")
    parser.add_argument("--out", default="tests/videos/features/trajectories.json")
    parser.add_argument("--min-hands", type=int, default=2)
    args = parser.parse_args()

    segments_dir = Path(args.segments_dir)
    labels_path = Path(args.labels)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    rows = []
    with labels_path.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            rows.append(row)

    results = []
    for row in rows:
        filename = row["filename"]
        video_path = segments_dir / filename
        if not video_path.exists():
            continue
        meta = extract_video(video_path, min_hands=max(1, args.min_hands))
        results.append(
            {
                "segment_index": int(row["segment_index"]),
                "filename": filename,
                "label": row.get("label", "").strip(),
                "notes": row.get("notes", "").strip(),
                **meta,
            }
        )
        print(
            f"[ok] {filename} points={len(meta['smoothed_points'])} "
            f"detect_ratio={meta['detection_ratio']:.2f} notes={row.get('notes','')}"
        )

    with out_path.open("w", encoding="utf-8") as f:
        json.dump({"items": results}, f, ensure_ascii=False, indent=2)
    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()
