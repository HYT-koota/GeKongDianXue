import cv2
import mediapipe as mp


def try_open(index, backend):
    cap = cv2.VideoCapture(index, backend)
    if not cap.isOpened():
        return None
    # Force a common format to avoid garbled frames on some drivers.
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, 30)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    ok, frame = cap.read()
    if not ok or frame is None:
        cap.release()
        return None
    return cap


def open_camera():
    # Try multiple combinations to avoid "garbled/static" camera output.
    for backend in (cv2.CAP_MSMF, cv2.CAP_DSHOW):
        for idx in (0, 1, 2):
            cap = try_open(idx, backend)
            if cap is not None:
                print(f"[INFO] Using camera index={idx}, backend={backend}")
                return cap
    # Fallback
    cap = cv2.VideoCapture(0)
    if cap.isOpened():
        return cap
    return cap


def main():
    print("[INFO] Starting MediaPipe webcam preview...")
    cap = open_camera()
    if not cap.isOpened():
        raise RuntimeError("Cannot open camera. Close Tencent Meeting/Camera app and retry.")

    try:
        cv2.namedWindow("MediaPipe Hands Preview", cv2.WINDOW_NORMAL)
    except cv2.error as e:
        raise RuntimeError(
            "OpenCV GUI is unavailable in this terminal session. "
            "Please run in normal desktop PowerShell/CMD."
        ) from e

    mp_hands = mp.solutions.hands
    mp_draw = mp.solutions.drawing_utils
    mp_styles = mp.solutions.drawing_styles

    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        model_complexity=0,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.4,
    )

    print("[INFO] Camera opened. Press Q to quit.")
    while True:
        ok, frame = cap.read()
        if not ok:
            print("[WARN] Failed to read frame, exiting.")
            break

        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = hands.process(rgb)

        hand_count = len(result.multi_hand_landmarks) if result.multi_hand_landmarks else 0
        if result.multi_hand_landmarks:
            for hand_landmarks in result.multi_hand_landmarks:
                mp_draw.draw_landmarks(
                    frame,
                    hand_landmarks,
                    mp_hands.HAND_CONNECTIONS,
                    mp_styles.get_default_hand_landmarks_style(),
                    mp_styles.get_default_hand_connections_style(),
                )

        cv2.putText(
            frame,
            f"Hands: {hand_count}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 255, 0),
            2,
        )
        cv2.putText(
            frame,
            "Q: Quit",
            (20, 80),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2,
        )

        cv2.imshow("MediaPipe Hands Preview", frame)
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break

    hands.close()
    cap.release()
    cv2.destroyAllWindows()
    print("[INFO] Closed.")


if __name__ == "__main__":
    main()
