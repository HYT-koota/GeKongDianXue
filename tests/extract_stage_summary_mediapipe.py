import argparse
import csv
import json
from pathlib import Path

import cv2
import mediapipe as mp


DUAL_POSE_MIN_FRAMES_BEFORE_ENDPOINT = 7
ENDPOINT_POSE_PRESENCE_THRESHOLD = 1
ENDPOINT_POSE_LOST_THRESHOLD = 4
POSE_PRESENCE_THRESHOLD = 1
ENDPOINT_MIN_DELAY_MS = 320
PHASE_B_MIN_SINGLE_HAND_FRAMES = 2
RELIABLE_TWO_HAND_MIN_WRIST_DISTANCE = 0.10
RELIABLE_TWO_HAND_UNLABELED_MIN_WRIST_DISTANCE = 0.22


def is_finger_extended(landmarks, tip_idx, pip_idx, mcp_idx):
    tip = landmarks[tip_idx]
    pip = landmarks[pip_idx]
    mcp = landmarks[mcp_idx]
    return tip.y < pip.y and pip.y < mcp.y


def is_target_hand_pose(landmarks):
    index_extended = is_finger_extended(landmarks, 8, 6, 5)
    middle_extended = is_finger_extended(landmarks, 12, 10, 9)
    ring_extended = is_finger_extended(landmarks, 16, 14, 13)
    pinky_extended = is_finger_extended(landmarks, 20, 18, 17)
    if not index_extended or not middle_extended:
        return False
    if ring_extended and pinky_extended:
        return False
    return True


def is_endpoint_pointing_pose(landmarks):
    if landmarks is None or len(landmarks) < 13:
        return False
    index_tip = landmarks[8]
    index_pip = landmarks[6]
    index_mcp = landmarks[5]
    middle_tip = landmarks[12]
    middle_pip = landmarks[10]
    middle_mcp = landmarks[9]
    wrist = landmarks[0]
    two_finger_pose = is_target_hand_pose(landmarks)
    strong_forward = (
        (index_tip.z < index_pip.z - 0.07 and middle_tip.z < middle_pip.z - 0.06)
        or (index_tip.z < index_mcp.z - 0.09 and middle_tip.z < middle_mcp.z - 0.08)
        or (index_tip.z < wrist.z - 0.12 and middle_tip.z < wrist.z - 0.10)
    )
    relaxed_forward = (
        (index_tip.z < wrist.z - 0.07 and index_tip.z < index_pip.z - 0.03)
        or (middle_tip.z < wrist.z - 0.07 and middle_tip.z < middle_pip.z - 0.03)
    )
    return (two_finger_pose and strong_forward) or relaxed_forward


def hand_label(handedness_entry):
    if handedness_entry is None:
        return None
    if hasattr(handedness_entry, "classification") and handedness_entry.classification:
        return handedness_entry.classification[0].label
    return None


def pick_right_hand(landmarks_list, handedness_list):
    if not landmarks_list:
        return None
    for i, hand in enumerate(landmarks_list):
        label = hand_label(handedness_list[i]) if i < len(handedness_list) else None
        if label == "Right":
            return hand.landmark
    if len(landmarks_list) == 1:
        return landmarks_list[0].landmark
    # Fallback: hand whose index tip is closer to camera.
    best = landmarks_list[0].landmark
    for i in range(1, len(landmarks_list)):
        cand = landmarks_list[i].landmark
        if cand[8].z < best[8].z:
            best = cand
    return best


def is_endpoint_hand_dominant(landmarks_list, handedness_list, z_gap_threshold=0.08):
    if len(landmarks_list) < 2:
        return True
    right_idx = -1
    for i in range(len(handedness_list)):
        label = hand_label(handedness_list[i])
        if label == "Right":
            right_idx = i
            break
    if right_idx < 0 or right_idx >= len(landmarks_list):
        return False

    right_z = landmarks_list[right_idx].landmark[8].z
    other_z = float("inf")
    for i in range(len(landmarks_list)):
        if i == right_idx:
            continue
        z = landmarks_list[i].landmark[8].z
        if z < other_z:
            other_z = z
    if other_z == float("inf"):
        return True
    return right_z <= other_z - z_gap_threshold


def has_reliable_two_hands(landmarks_list, handedness_list):
    if len(landmarks_list) < 2:
        return False
    wrist_a = landmarks_list[0].landmark[0]
    wrist_b = landmarks_list[1].landmark[0]
    dx = wrist_a.x - wrist_b.x
    dy = wrist_a.y - wrist_b.y
    wrist_distance = (dx * dx + dy * dy) ** 0.5
    has_both_labels = False
    if len(handedness_list) >= 2:
        labels = [hand_label(h) for h in handedness_list]
        has_both_labels = ("Left" in labels and "Right" in labels)

    if has_both_labels:
        return wrist_distance >= RELIABLE_TWO_HAND_MIN_WRIST_DISTANCE
    return wrist_distance >= RELIABLE_TWO_HAND_UNLABELED_MIN_WRIST_DISTANCE


def extract_stage_summary(video_path: Path, min_hands: int = 2):
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
        min_detection_confidence=0.5,
        min_tracking_confidence=0.35,
    )

    dual_pose_locked = False
    dual_pose_frame_counter = 0
    dual_pose_peak = 0
    pose_presence_counter = 0
    pose_lost_counter = 0
    pose_stable = False
    single_hand_phase_counter = 0

    endpoint_presence_counter = 0
    endpoint_lost_counter = 0
    endpoint_stable = False
    endpoint_seen_after_phase_a = False
    endpoint_seen_while_two_hands = False

    first_phase_a_ts = None
    first_endpoint_ts = None
    first_endpoint_after_phase_a_ts = None

    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        ts = int((idx / fps) * 1000)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb)
        landmarks_list = results.multi_hand_landmarks or []
        handedness_list = results.multi_handedness or []

        hand_count = len(landmarks_list)

        reliable_two_hands = has_reliable_two_hands(landmarks_list, handedness_list)
        pose_matched_now = False
        if reliable_two_hands and hand_count >= max(2, min_hands):
            for hand in landmarks_list:
                if is_target_hand_pose(hand.landmark):
                    pose_matched_now = True
                    break

        if pose_matched_now:
            pose_presence_counter += 1
            pose_lost_counter = 0
        else:
            pose_lost_counter += 1
            pose_presence_counter = 0

        pose_stable = pose_presence_counter >= POSE_PRESENCE_THRESHOLD

        if pose_stable:
            dual_pose_locked = True
            dual_pose_frame_counter += 1
            dual_pose_peak = max(dual_pose_peak, dual_pose_frame_counter)
            if first_phase_a_ts is None and dual_pose_frame_counter >= DUAL_POSE_MIN_FRAMES_BEFORE_ENDPOINT:
                first_phase_a_ts = ts
            single_hand_phase_counter = 0
        elif dual_pose_locked:
            if hand_count == 1:
                single_hand_phase_counter += 1
            else:
                single_hand_phase_counter = 0

        phase_b_allowed = (
            dual_pose_locked
            and single_hand_phase_counter >= PHASE_B_MIN_SINGLE_HAND_FRAMES
            and
            dual_pose_frame_counter >= DUAL_POSE_MIN_FRAMES_BEFORE_ENDPOINT
            and first_phase_a_ts is not None
            and (ts - first_phase_a_ts) >= ENDPOINT_MIN_DELAY_MS
            and hand_count == 1
        )

        endpoint_hand = pick_right_hand(landmarks_list, handedness_list)
        endpoint_allowed_by_hand_state = hand_count == 1
        endpoint_now = phase_b_allowed and endpoint_allowed_by_hand_state and is_endpoint_pointing_pose(endpoint_hand)
        endpoint_raw_now = endpoint_hand is not None and is_endpoint_pointing_pose(endpoint_hand)

        if endpoint_raw_now and hand_count >= 2:
            endpoint_seen_while_two_hands = True

        if endpoint_now:
            endpoint_presence_counter += 1
            endpoint_lost_counter = 0
            if first_endpoint_after_phase_a_ts is None:
                first_endpoint_after_phase_a_ts = ts
        else:
            endpoint_lost_counter += 1
            endpoint_presence_counter = 0

        endpoint_stable = (
            endpoint_presence_counter >= ENDPOINT_POSE_PRESENCE_THRESHOLD
            and endpoint_lost_counter < ENDPOINT_POSE_LOST_THRESHOLD
        )
        if endpoint_raw_now and first_endpoint_ts is None:
            first_endpoint_ts = ts
        if endpoint_stable:
            endpoint_seen_after_phase_a = True

        idx += 1

    hands.close()
    cap.release()

    return {
        "frame_count": frame_count,
        "fps": fps,
        "phase_a_ready": dual_pose_peak >= DUAL_POSE_MIN_FRAMES_BEFORE_ENDPOINT,
        "phase_a_peak_frames": dual_pose_peak,
        "endpoint_seen_after_phase_a": endpoint_seen_after_phase_a,
        "endpoint_seen_while_two_hands": endpoint_seen_while_two_hands,
        "first_phase_a_ts": first_phase_a_ts,
        "first_endpoint_ts": first_endpoint_ts,
        "first_endpoint_after_phase_a_ts": first_endpoint_after_phase_a_ts,
    }


def main():
    parser = argparse.ArgumentParser(description="Extract two-stage gesture summaries from labeled segment videos.")
    parser.add_argument("--segments-dir", required=True)
    parser.add_argument("--labels", required=True)
    parser.add_argument("--out", required=True)
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

    items = []
    for row in rows:
        filename = row.get("filename", "").strip()
        if not filename:
            continue
        video_path = segments_dir / filename
        if not video_path.exists():
            continue
        summary = extract_stage_summary(video_path, min_hands=max(1, args.min_hands))
        item = {
            "dataset": labels_path.name,
            "segment_index": int(row.get("segment_index", "0") or 0),
            "filename": filename,
            "label": row.get("label", "").strip(),
            "notes": row.get("notes", "").strip(),
            **summary,
        }
        items.append(item)
        print(
            f"[ok] {filename} phaseA={item['phase_a_ready']} "
            f"endpointAfterA={item['endpoint_seen_after_phase_a']} "
            f"endpointWhile2H={item['endpoint_seen_while_two_hands']}"
        )

    payload = {
        "segments_dir": str(segments_dir),
        "labels": str(labels_path),
        "items": items,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()
