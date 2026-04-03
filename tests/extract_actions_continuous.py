import argparse
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


def speed(a, b):
    dt = max(1, b["timestamp"] - a["timestamp"])
    dx = b["x"] - a["x"]
    dy = b["y"] - a["y"]
    return ((dx * dx + dy * dy) ** 0.5) / (dt / 1000.0)


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
    for i, hand in enumerate(landmarks_list):
        label = hand_label(handedness_list[i]) if i < len(handedness_list) else None
        if label == "Right":
            return hand.landmark
    return landmarks_list[0].landmark


def extract_points(video_path: Path, min_detection_conf=0.5, min_tracking_conf=0.35, min_hands=2):
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        model_complexity=0,
        min_detection_confidence=min_detection_conf,
        min_tracking_confidence=min_tracking_conf,
    )

    frames = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb)
        ts = int((idx / fps) * 1000)
        if results.multi_hand_landmarks and len(results.multi_hand_landmarks) >= min_hands:
            hand = pick_anchor_hand(results)
            if hand is None:
                idx += 1
                continue
            ax = (hand[8].x + hand[12].x) / 2
            ay = (hand[8].y + hand[12].y) / 2
            frames.append(
                {
                    "frame_index": idx,
                    "timestamp": ts,
                    "has_hand": True,
                    "x": float(ax),
                    "y": float(ay),
                }
            )
        else:
            frames.append(
                {
                    "frame_index": idx,
                    "timestamp": ts,
                    "has_hand": False,
                    "x": None,
                    "y": None,
                }
            )
        idx += 1

    hands.close()
    cap.release()
    return {
        "fps": fps,
        "frame_count": frame_count,
        "duration_sec": frame_count / fps if fps > 0 else 0,
        "frames": frames,
    }


def segment_actions(
    frames,
    min_points=10,
    hand_lost_end_frames=6,
    low_speed_end_frames=24,
    low_speed_threshold=0.015,
    start_speed_threshold=0.04,
    min_action_ms=2200,
):
    segments = []
    active_points = []
    active_start_ts = None
    hand_lost_count = 0
    low_speed_count = 0
    prev_point = None
    active = False

    # End-of-action heuristics: hand lost or speed drops for a while.
    def close_segment(end_ts):
        nonlocal active_points, active_start_ts, prev_point, low_speed_count, hand_lost_count, active
        if len(active_points) >= min_points:
            smoothed = smooth(active_points, window=5)
            segments.append(
                {
                    "start_timestamp": active_start_ts,
                    "end_timestamp": end_ts,
                    "duration_ms": end_ts - active_start_ts,
                    "point_count": len(smoothed),
                    "trajectory": smoothed,
                }
            )
        active_points = []
        active_start_ts = None
        prev_point = None
        low_speed_count = 0
        hand_lost_count = 0
        active = False

    for fr in frames:
        if not fr["has_hand"]:
            hand_lost_count += 1
            if active and hand_lost_count >= hand_lost_end_frames:
                close_segment(fr["timestamp"])
            continue

        hand_lost_count = 0
        curr = {"x": fr["x"], "y": fr["y"], "timestamp": fr["timestamp"]}
        curr_speed = speed(prev_point, curr) if prev_point else 0.0
        prev_point = curr

        if not active:
            if curr_speed >= start_speed_threshold:
                active = True
                active_start_ts = fr["timestamp"]
                active_points.append(curr)
            continue

        active_points.append(curr)
        if curr_speed < low_speed_threshold:
            low_speed_count += 1
        else:
            low_speed_count = 0

        duration_ms = fr["timestamp"] - (active_start_ts or fr["timestamp"])
        if low_speed_count >= low_speed_end_frames and duration_ms >= min_action_ms:
            close_segment(fr["timestamp"])

    if active:
        end_ts = frames[-1]["timestamp"] if frames else 0
        close_segment(end_ts)

    return segments


def main():
    parser = argparse.ArgumentParser(description="Extract action segments from one continuous hand-gesture video.")
    parser.add_argument("--input", required=True, help="Input video path")
    parser.add_argument("--out", required=True, help="Output json path")
    parser.add_argument("--label", default="1", help="Label to assign to each segment")
    parser.add_argument("--notes", default="", help="Notes to assign to each segment")
    parser.add_argument("--min-detection-conf", type=float, default=0.5)
    parser.add_argument("--min-tracking-conf", type=float, default=0.35)
    parser.add_argument("--min-hands", type=int, default=2)
    parser.add_argument("--min-points", type=int, default=10)
    parser.add_argument("--hand-lost-end-frames", type=int, default=6)
    parser.add_argument("--low-speed-end-frames", type=int, default=24)
    parser.add_argument("--low-speed-threshold", type=float, default=0.015)
    parser.add_argument("--start-speed-threshold", type=float, default=0.04)
    parser.add_argument("--min-action-ms", type=int, default=2200)
    args = parser.parse_args()

    in_path = Path(args.input)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    extracted = extract_points(
        in_path,
        min_detection_conf=args.min_detection_conf,
        min_tracking_conf=args.min_tracking_conf,
        min_hands=max(1, args.min_hands),
    )
    segments = segment_actions(
        extracted["frames"],
        min_points=args.min_points,
        hand_lost_end_frames=args.hand_lost_end_frames,
        low_speed_end_frames=args.low_speed_end_frames,
        low_speed_threshold=args.low_speed_threshold,
        start_speed_threshold=args.start_speed_threshold,
        min_action_ms=args.min_action_ms,
    )

    items = []
    for i, seg in enumerate(segments, start=1):
        items.append(
            {
                "segment_index": i,
                "filename": in_path.name,
                "label": args.label,
                "notes": args.notes,
                "duration_ms": seg["duration_ms"],
                "point_count": seg["point_count"],
                "smoothed_points": seg["trajectory"],
            }
        )

    payload = {
        "video": str(in_path),
        "fps": extracted["fps"],
        "frame_count": extracted["frame_count"],
        "duration_sec": extracted["duration_sec"],
        "segment_count": len(items),
        "items": items,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=== Continuous Extraction Complete ===")
    print(f"video: {in_path}")
    print(f"duration_sec: {extracted['duration_sec']:.2f}")
    print(f"segments: {len(items)}")
    for it in items:
        print(
            f"  segment#{it['segment_index']} points={it['point_count']} duration_ms={it['duration_ms']}"
        )
    print(f"out: {out_path}")


if __name__ == "__main__":
    main()
