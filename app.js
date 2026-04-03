// ============================================================================
// CONFIGURATION (defined in shared.js)
// ============================================================================
// CONFIG is defined in shared.js, using very lenient thresholds:
// - minPeakSpeedRatio: 0.3 (非常宽松：30%)
// - minAvgSpeedRatio: 0.3 (非常宽松：30%)
// - similarityThreshold: 0.5
// - combinedThreshold: 0.3 (综合得分阈值：0.3)

// ============================================================================
// EMBEDDED STANDARD GESTURE (from exported data)
// ============================================================================
const STANDARD_GESTURE = {
    normalizedTrajectory: [
        { x: -0.4335, y: 0.2445, timestamp: 0 },
        { x: -0.3283, y: -0.0957, timestamp: 100 },
        { x: -0.2946, y: 0.0835, timestamp: 200 },
        { x: -0.2505, y: 0.1496, timestamp: 300 },
        { x: -0.2058, y: 0.2282, timestamp: 400 },
        { x: -0.1661, y: 0.3154, timestamp: 500 },
        { x: -0.1331, y: 0.3937, timestamp: 600 },
        { x: -0.0999, y: 0.4597, timestamp: 700 },
        { x: -0.0712, y: 0.5118, timestamp: 800 },
        { x: -0.0389, y: 0.5563, timestamp: 900 },
        { x: 0.0067, y: 0.5892, timestamp: 1000 },
        { x: 0.0402, y: 0.6062, timestamp: 1100 },
        { x: 0.0825, y: 0.6217, timestamp: 1200 },
        { x: 0.1228, y: 0.6231, timestamp: 1300 },
        { x: 0.1572, y: 0.6186, timestamp: 1400 },
        { x: 0.1827, y: 0.6059, timestamp: 1500 },
        { x: 0.2037, y: 0.5818, timestamp: 1600 },
        { x: 0.2137, y: 0.5518, timestamp: 1700 },
        { x: 0.2196, y: 0.5174, timestamp: 1800 },
        { x: 0.2195, y: 0.4807, timestamp: 1900 },
        { x: 0.2143, y: 0.4352, timestamp: 2000 },
        { x: 0.2058, y: 0.3835, timestamp: 2100 },
        { x: 0.1947, y: 0.3269, timestamp: 2200 },
        { x: 0.1817, y: 0.2673, timestamp: 2300 },
        { x: 0.1672, y: 0.2032, timestamp: 2400 },
        { x: 0.1507, y: 0.1354, timestamp: 2500 },
        { x: 0.1330, y: 0.0657, timestamp: 2600 },
        { x: 0.1143, y: -0.0054, timestamp: 2700 },
        { x: 0.0963, y: -0.0688, timestamp: 2800 },
        { x: 0.0795, y: -0.1317, timestamp: 2900 },
        { x: 0.0639, y: -0.1873, timestamp: 3000 },
        { x: 0.0490, y: -0.2358, timestamp: 3100 },
        { x: 0.0362, y: -0.2758, timestamp: 3200 },
        { x: 0.0269, y: -0.3047, timestamp: 3300 },
        { x: 0.0211, y: -0.3234, timestamp: 3400 },
        { x: 0.0184, y: -0.3329, timestamp: 3500 },
        { x: 0.0191, y: -0.3332, timestamp: 3600 },
        { x: 0.0240, y: -0.3271, timestamp: 3700 },
        { x: 0.0343, y: -0.3119, timestamp: 3800 },
        { x: 0.0488, y: -0.2865, timestamp: 3900 },
        { x: 0.0676, y: -0.2520, timestamp: 4000 },
        { x: 0.0892, y: -0.2098, timestamp: 4100 },
        { x: 0.1122, y: -0.1635, timestamp: 4200 },
        { x: 0.1365, y: -0.1141, timestamp: 4300 },
        { x: 0.1609, y: -0.0633, timestamp: 4400 },
        { x: 0.1861, y: -0.0098, timestamp: 4500 },
        { x: 0.2094, y: 0.0396, timestamp: 4600 },
        { x: 0.2317, y:  0.0900, timestamp: 4700 },
        { x: 0.2528, y: 0.1366, timestamp: 4800 },
        { x: 0.2713, y: 0.1775, timestamp: 4900 },
        { x: 0.2865, y: 0.2140, timestamp: 5000 }
    ],
    speedProfile: {
        peakSpeed: 5.68,
        avgSpeed: 1.13
    },
    recordingCount: 15
};

// ============================================================================
// GLOBAL STATE
// ============================================================================
let hands = null;
let camera = null;
let isInitialized = false;
let standardGesture = STANDARD_GESTURE;
let trajectoryCollector = new TrajectoryCollector(CONFIG);
let candleRenderer = null;
let gestureMatcher = null;

// Matching state
let isMatching = true;
let lastMatchTime = 0;
let matchCooldown = 800; // 更宽松：允许更快连续触发
let lastEvaluationTime = 0;
const EVAL_INTERVAL_MS = 100;
let matchStreak = 0;
const MATCH_STREAK_REQUIRED = 1;

// State tracking for logging
let lastHandState = false; // 上次是否有手
let lastIdleState = false; // 上次是否静止
let lastTrajectoryLength = 0; // 上次轨迹点数
let logSuppressed = false; // 是否已输出"日志抑制"消息

// Hand detection stabilization
let handPresenceCounter = 0; // 手部存在连续计数
let handLostCounter = 0;     // 手部丢失连续计数
const HAND_PRESENCE_THRESHOLD = 1; // 放宽：单帧检测到手即进入稳定态
const HAND_LOST_THRESHOLD = 18;     // 放宽：更长时间看不到手才判丢失
let handStable = false;     // 手部是否稳定存在

let posePresenceCounter = 0;
let poseLostCounter = 0;
const POSE_PRESENCE_THRESHOLD = 1;
const POSE_LOST_THRESHOLD = 2;
let poseStable = false;

let dualPoseLocked = false;
let dualPoseFrameCounter = 0;
const DUAL_POSE_MIN_FRAMES_BEFORE_ENDPOINT = 7;
let phaseBEntered = false;
let singleHandPhaseCounter = 0;
const PHASE_B_MIN_SINGLE_HAND_FRAMES = 1;
const PHASE_B_GHOST_DOMINANT_Z_GAP = 0.12;
const RELIABLE_TWO_HAND_MIN_WRIST_DISTANCE = 0.10;
const RELIABLE_TWO_HAND_UNLABELED_MIN_WRIST_DISTANCE = 0.22;
let lastFusedPoint = null;
let noHandGraceCounter = 0;
const NO_HAND_GRACE_FRAMES = 24;
let endpointPosePresenceCounter = 0;
let endpointPoseLostCounter = 0;
const ENDPOINT_POSE_PRESENCE_THRESHOLD = 1;
const ENDPOINT_POSE_LOST_THRESHOLD = 4;
let endpointPoseStable = false;
let endpointSeenInAction = false;
let requireRearm = false;
let rearmCounter = 0;
const REARM_FRAMES = 8;

const QUALITY_WINDOW_SIZE = 30;
const MIN_DETECTION_COVERAGE = 0.2;
let detectionHistory = [];

// DOM Elements
const videoElement = document.getElementById('videoElement');
const canvasOutput = document.getElementById('canvasOutput');
const ctxOutput = canvasOutput.getContext('2d');
const candleCanvas = document.getElementById('candleCanvas');
const candleContainer = document.getElementById('candleContainer');
const statusIndicator = document.getElementById('statusIndicator');
const btnReset = document.getElementById('btnReset');
const particlesContainer = document.getElementById('particles');
const testModeToggle = document.getElementById('testModeToggle');

// Debug elements
const debugToggle = document.getElementById('debugToggle');
const debugPanel = document.getElementById('debugPanel');
let debugVisible = false;
let testMode = false;

const HAND_BONES = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],[0,17]
];

async function resolveStandardGesture() {
    // 1) Try project-level learned standard file.
    try {
        const response = await fetch(`standard_gesture.json?v=${Date.now()}`, { cache: 'no-store' });
        if (response.ok) {
            const data = await response.json();
            if (data?.normalizedTrajectory?.length && data?.speedProfile) {
                console.log('Loaded learned standard from standard_gesture.json');
                return data;
            }
        }
    } catch (error) {
        console.warn('Failed to load standard_gesture.json, fallback to embedded standard:', error.message);
    }
    return STANDARD_GESTURE;
}

function pushDetectionQuality(hasHand) {
    detectionHistory.push(hasHand ? 1 : 0);
    if (detectionHistory.length > QUALITY_WINDOW_SIZE) {
        detectionHistory.shift();
    }
}

function getDetectionCoverage() {
    if (detectionHistory.length === 0) return 1;
    const detected = detectionHistory.reduce((sum, flag) => sum + flag, 0);
    return detected / detectionHistory.length;
}

function resetTrackingState() {
    trajectoryCollector.reset();
    matchStreak = 0;
    posePresenceCounter = 0;
    poseLostCounter = 0;
    poseStable = false;
    dualPoseLocked = false;
    dualPoseFrameCounter = 0;
    phaseBEntered = false;
    singleHandPhaseCounter = 0;
    lastFusedPoint = null;
    noHandGraceCounter = 0;
    endpointPosePresenceCounter = 0;
    endpointPoseLostCounter = 0;
    endpointPoseStable = false;
    endpointSeenInAction = false;
    lastTrajectoryLength = 0;
    logSuppressed = false;
    document.getElementById('debugPoints').textContent = '0';
}

function markActionComplete(nextStatus) {
    resetTrackingState();
    requireRearm = false;
    rearmCounter = 0;
    if (nextStatus) {
        updateStatus(nextStatus, 'waiting');
    }
}

function setTestMode(enabled) {
    testMode = enabled;
    if (testModeToggle) {
        testModeToggle.textContent = enabled ? 'Test Mode: ON' : 'Test Mode: OFF';
        testModeToggle.classList.toggle('active', enabled);
    }
    canvasOutput.style.display = enabled ? 'block' : 'none';
    if (!enabled) {
        ctxOutput.clearRect(0, 0, canvasOutput.width, canvasOutput.height);
    }
}

function drawHandSkeleton(landmarksList) {
    if (!testMode || !landmarksList || landmarksList.length === 0) return;

    ctxOutput.clearRect(0, 0, canvasOutput.width, canvasOutput.height);
    const colors = ['rgba(0, 255, 120, 0.9)', 'rgba(0, 170, 255, 0.9)'];

    landmarksList.forEach((landmarks, handIdx) => {
        const strokeColor = colors[handIdx % colors.length];
        ctxOutput.strokeStyle = strokeColor;
        ctxOutput.lineWidth = 2;
        for (const [a, b] of HAND_BONES) {
            const p1 = landmarks[a];
            const p2 = landmarks[b];
            ctxOutput.beginPath();
            ctxOutput.moveTo(p1.x * canvasOutput.width, p1.y * canvasOutput.height);
            ctxOutput.lineTo(p2.x * canvasOutput.width, p2.y * canvasOutput.height);
            ctxOutput.stroke();
        }

        for (let i = 0; i < landmarks.length; i++) {
            const p = landmarks[i];
            const x = p.x * canvasOutput.width;
            const y = p.y * canvasOutput.height;
            ctxOutput.beginPath();
            ctxOutput.arc(x, y, i === 8 || i === 12 ? 4 : 2, 0, Math.PI * 2);
            ctxOutput.fillStyle = i === 8 || i === 12 ? '#ffd166' : '#ff4d4d';
            ctxOutput.fill();
        }
    });
}

function addBridgePoint(timestamp) {
    if (!lastFusedPoint) return false;
    trajectoryCollector.addPoint(lastFusedPoint.x, lastFusedPoint.y, timestamp);
    return true;
}

function isEndpointPointingPose(landmarks) {
    if (!landmarks || landmarks.length < 13) return false;
    const indexTip = landmarks[8];
    const indexPip = landmarks[6];
    const indexMcp = landmarks[5];
    const middleTip = landmarks[12];
    const middlePip = landmarks[10];
    const middleMcp = landmarks[9];
    const wrist = landmarks[0];
    const twoFingerPose = isTargetHandPose(landmarks);
    // Stronger endpoint rule:
    // - keep target two-finger pose
    // - index/middle tips clearly move toward camera (smaller z)
    // This reduces early trigger during "hand flower" stage.
    const strongForward =
        (indexTip.z < indexPip.z - 0.07 && middleTip.z < middlePip.z - 0.06) ||
        (indexTip.z < indexMcp.z - 0.09 && middleTip.z < middleMcp.z - 0.08) ||
        (indexTip.z < wrist.z - 0.12 && middleTip.z < wrist.z - 0.10);
    // Relaxed fallback for real-camera jitter:
    // if one leading finger clearly moves forward, count it as endpoint.
    const relaxedForward =
        (indexTip.z < wrist.z - 0.065 && indexTip.z < indexPip.z - 0.025) ||
        (middleTip.z < wrist.z - 0.065 && middleTip.z < middlePip.z - 0.025);

    return (twoFingerPose && strongForward) || relaxedForward;
}

function pickEndpointHandLandmarks(results) {
    const landmarksList = results.multiHandLandmarks || [];
    const handednessList = results.multiHandedness || [];
    if (landmarksList.length === 0) return null;

    // Prefer the hand recognized as Right.
    for (let i = 0; i < handednessList.length; i++) {
        const label = handednessList[i]?.label;
        if (label === 'Right' && landmarksList[i]) {
            return landmarksList[i];
        }
    }

    // Fallback: pick the hand whose index tip is closer to camera (smaller z).
    let best = landmarksList[0];
    for (let i = 1; i < landmarksList.length; i++) {
        if ((landmarksList[i]?.[8]?.z ?? 0) < (best?.[8]?.z ?? 0)) {
            best = landmarksList[i];
        }
    }
    return best;
}

function isEndpointHandDominant(results, zGapThreshold = 0.08) {
    const landmarksList = results.multiHandLandmarks || [];
    const handednessList = results.multiHandedness || [];
    if (landmarksList.length < 2) return true;

    let rightIdx = -1;
    for (let i = 0; i < handednessList.length; i++) {
        if (handednessList[i]?.label === 'Right') {
            rightIdx = i;
            break;
        }
    }
    if (rightIdx < 0 || rightIdx >= landmarksList.length) return false;

    const rightZ = landmarksList[rightIdx]?.[8]?.z ?? 0;
    let otherZ = Infinity;
    for (let i = 0; i < landmarksList.length; i++) {
        if (i === rightIdx) continue;
        const z = landmarksList[i]?.[8]?.z ?? Infinity;
        if (z < otherZ) otherZ = z;
    }
    if (!Number.isFinite(otherZ)) return true;
    // MediaPipe z smaller means closer to camera.
    return rightZ <= otherZ - zGapThreshold;
}

function hasReliableTwoHands(results) {
    const landmarksList = results.multiHandLandmarks || [];
    const handednessList = results.multiHandedness || [];
    if (landmarksList.length < 2) return false;

    const wristA = landmarksList[0]?.[0];
    const wristB = landmarksList[1]?.[0];
    if (!wristA || !wristB) return false;

    const dx = wristA.x - wristB.x;
    const dy = wristA.y - wristB.y;
    const wristDistance = Math.sqrt(dx * dx + dy * dy);
    let hasBothLabels = false;
    if (handednessList.length >= 2) {
        const labels = handednessList
            .map((h) => h?.label)
            .filter(Boolean);
        hasBothLabels = labels.includes('Left') && labels.includes('Right');
    }

    // If handedness is reliable, use normal distance threshold.
    if (hasBothLabels) {
        return wristDistance >= RELIABLE_TWO_HAND_MIN_WRIST_DISTANCE;
    }

    // If handedness is noisy/missing, still allow clearly separated two hands.
    return wristDistance >= RELIABLE_TWO_HAND_UNLABELED_MIN_WRIST_DISTANCE;
}

function isFingerExtended(landmarks, tipIndex, pipIndex, mcpIndex) {
    const tip = landmarks[tipIndex];
    const pip = landmarks[pipIndex];
    const mcp = landmarks[mcpIndex];
    // In MediaPipe image coords, smaller y means more "up".
    return tip.y < pip.y && pip.y < mcp.y;
}

function isTargetHandPose(landmarks) {
    const indexExtended = isFingerExtended(landmarks, 8, 6, 5);
    const middleExtended = isFingerExtended(landmarks, 12, 10, 9);
    const ringExtended = isFingerExtended(landmarks, 16, 14, 13);
    const pinkyExtended = isFingerExtended(landmarks, 20, 18, 17);
    if (!indexExtended || !middleExtended) return false;
    // Block open-palm style pose (both ring and pinky clearly extended).
    if (ringExtended && pinkyExtended) return false;
    return true;
}

// ============================================================================
// STATUS INDICATOR
// ============================================================================
function updateStatus(message, type = 'waiting') {
    statusIndicator.textContent = message;
    statusIndicator.className = 'status-indicator ' + type;
}

// ============================================================================
// DEBUG INFO UPDATE
// ============================================================================
function updateDebugInfo() {
    document.getElementById('debugStandard').textContent = '已加载';
    document.getElementById('debugRecordCount').textContent = standardGesture.recordingCount;
    const stdSpeed = standardGesture.speedProfile;
    document.getElementById('debugStdPeak').textContent = stdSpeed.peakSpeed.toFixed(3);
    document.getElementById('debugStdAvg').textContent = stdSpeed.avgSpeed.toFixed(3);
    const debugThresholdEl = document.getElementById('debugThreshold');
    if (debugThresholdEl) {
        debugThresholdEl.textContent = CONFIG.combinedThreshold.toFixed(2);
    }

    // Update min ratios display
    const minPeakEl = document.getElementById('debugMinPeak');
    if (minPeakEl) minPeakEl.textContent = CONFIG.minPeakSpeedRatio.toFixed(2);
    const minAvgEl = document.getElementById('debugMinAvg');
    if (minAvgEl) minAvgEl.textContent = CONFIG.minAvgSpeedRatio.toFixed(2);
}

// ============================================================================
// UPDATE MATCH DEBUG INFO
// ============================================================================
function updateMatchDebug(result, currentSpeed) {
    // 总是更新调试面板中的得分，即使面板不可见
    // 这样用户可以随时打开面板查看最近一次匹配结果

    // Update match scores
    const similarityEl = document.getElementById('debugSimilarity');
    if (similarityEl && result.details.similarityScore !== undefined) {
        similarityEl.textContent = result.details.similarityScore.toFixed(3);
        similarityEl.className = 'debug-value ' + (
            result.details.similarityScore >= CONFIG.similarityThreshold ? 'good' : 'high'
        );
    }

    const speedEl = document.getElementById('debugSpeed');
    if (speedEl) {
        speedEl.textContent = result.details.speedScore ? '✓' : '✗';
        speedEl.className = 'debug-value ' + (result.details.speedScore ? 'good' : 'high');
    }

    const combinedEl = document.getElementById('debugCombined');
    if (combinedEl && result.confidence !== undefined) {
        combinedEl.textContent = result.confidence.toFixed(3);
        combinedEl.className = 'debug-value ' + (
            result.confidence >= CONFIG.combinedThreshold ? 'good' : 'high'
        );
    }

    // Update speed comparison
    if (currentSpeed) {
        const currPeakEl = document.getElementById('debugCurrPeak');
        if (currPeakEl) currPeakEl.textContent = currentSpeed.peakSpeed.toFixed(3);

        const currAvgEl = document.getElementById('debugCurrAvg');
        if (currAvgEl) currAvgEl.textContent = currentSpeed.avgSpeed.toFixed(3);

        const stdPeak = standardGesture.speedProfile.peakSpeed;
        const stdAvg = standardGesture.speedProfile.avgSpeed;

        const peakRatioEl = document.getElementById('debugPeakRatio');
        if (peakRatioEl && stdPeak > 0) {
            const ratio = currentSpeed.peakSpeed / stdPeak;
            peakRatioEl.textContent = ratio.toFixed(3);
            peakRatioEl.className = 'debug-value ' + (
                ratio >= CONFIG.minPeakSpeedRatio ? 'good' : 'high'
            );
        }

        const avgRatioEl = document.getElementById('debugAvgRatio');
        if (avgRatioEl && stdAvg > 0) {
            const ratio = currentSpeed.avgSpeed / stdAvg;
            avgRatioEl.textContent = ratio.toFixed(3);
            avgRatioEl.className = 'debug-value ' + (
                ratio >= CONFIG.minAvgSpeedRatio ? 'good' : 'high'
            );
        }
    }
}

function evaluateCurrentTrajectory(trajectory, reason = 'idle') {
    const duration = trajectoryCollector.getDuration();
    if (duration < (CONFIG.minGestureDurationMs || 0)) {
        console.log('Trajectory too short, skip:', duration, 'ms');
        updateStatus('动作还不完整，请继续做到指向结束', 'waiting');
        return { evaluated: false, matched: false };
    }

    const coverage = getDetectionCoverage();
    if (coverage < MIN_DETECTION_COVERAGE) {
        console.log('Detection coverage too low, discard trajectory:', coverage.toFixed(2));
        updateStatus('Tracking unstable, please retry a bit slower', 'waiting');
        resetTrackingState();
        return { evaluated: false, matched: false };
    }

    const now = Date.now();
    const result = gestureMatcher.evaluate(trajectory, standardGesture);
    // Trajectory/speed are primary; endpoint pose is now a boost, not a hard gate.
    const similarity = result.details?.similarityScore ?? 0;
    const speedMatched = result.details?.speedScore === 1;
    const confidence = result.confidence ?? 0;

    // Two-stage decision:
    // 1) before endpoint pose is stable -> stricter, avoid early false trigger during "hand flower"
    // 2) endpoint pose appears -> relax slightly to improve true positive rate
    const strictMatch =
        (similarity >= 0.32 && confidence >= 0.26) ||
        (speedMatched && similarity >= 0.28 && confidence >= 0.22);
    // Once endpoint is clearly observed, loosen match so fast real actions won't be missed.
    const endpointBoostMatch =
        (similarity >= 0.16 && confidence >= 0.12) ||
        (speedMatched && similarity >= 0.12) ||
        confidence >= 0.16;
    const baseMatched = endpointPoseStable ? endpointBoostMatch : strictMatch;
    // Hard order gate: action must include endpoint stage after flower stage.
    const finalMatched = endpointSeenInAction && baseMatched;
    lastEvaluationTime = now;
    matchStreak = finalMatched ? matchStreak + 1 : 0;

    console.log('=== Match Result ===');
    console.log('Reason:', reason);
    console.log('Trajectory points:', trajectory.length);
    console.log('Duration:', duration, 'ms (', (duration / 1000).toFixed(2), 's)');
    console.log('DTW:', result.details.dtwDistance?.toFixed(4));
    console.log('Similarity:', result.details.similarityScore?.toFixed(3));
    console.log('Speed score:', result.details.speedScore);
    console.log('Confidence:', result.confidence?.toFixed(3));
    console.log('Endpoint pose stable:', endpointPoseStable);
    console.log('Endpoint seen in action:', endpointSeenInAction);
    console.log('Matched(raw):', result.isMatched);
    console.log('Matched(final):', finalMatched);
    console.log('Match streak:', matchStreak, '/', MATCH_STREAK_REQUIRED);
    console.log('================');

    updateMatchDebug(result, result.details.currentSpeed);

    if (finalMatched && matchStreak >= MATCH_STREAK_REQUIRED && candleRenderer.isLit) {
        candleRenderer.extinguish();
        lastMatchTime = now;
        updateStatus('Gesture matched, candle extinguished!', 'matched');

        setTimeout(() => {
            if (!candleRenderer.isLit) {
                updateStatus('Click "Reset Candle" to continue', 'waiting');
            }
        }, 2000);
        markActionComplete('Action captured. Lower hands, then start next action.');
        return { evaluated: true, matched: true };
    }
    if (reason === 'progress') {
        // Progress checks are non-terminal. Keep collecting trajectory.
        if (!endpointSeenInAction) {
            updateStatus('Continue action: wait for forward-point endpoint', 'waiting');
        } else {
            updateStatus('Action in progress...', 'waiting');
        }
        return { evaluated: true, matched: false, continueTracking: true };
    }

    markActionComplete('Action ended but not matched. Lower hands and retry.');
    return { evaluated: true, matched: false, continueTracking: false };
}

// ============================================================================
// MEDIAPIPE INITIALIZATION
// ============================================================================
async function initializeMediaPipe() {
    updateStatus('正在初始化 MediaPipe Hands...', 'waiting');

    try {
        // Initialize Hands
        hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
            }
        });

        hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 0,            // 使用简单模型提高稳定性（对小手指动作更敏感）
            minDetectionConfidence: 0.5,    // 残影场景下进一步提高检出率
            minTrackingConfidence: 0.35     // 允许更快动作中的短时抖动
        });

        hands.onResults(onResults);

        // Initialize Camera (same resolution as recording page for consistency)
        camera = new Camera(videoElement, {
            onFrame: async () => {
                await hands.send({ image: videoElement });
            },
            width: 480,
            height: 360
        });

        await camera.start();

        // Setup output canvas (same as camera resolution)
        canvasOutput.width = 480;
        canvasOutput.height = 360;
        setTestMode(false);

        // Load learned standard gesture if available.
        standardGesture = await resolveStandardGesture();

        // Initialize candle renderer
        candleRenderer = new CandleRenderer(candleCanvas, candleCanvas.getContext('2d'), candleContainer);
        candleRenderer.start();

        // Initialize gesture matcher
        gestureMatcher = new GestureMatcher(CONFIG);

        isInitialized = true;
        updateStatus('🕯️ 已就绪 - 做点穴动作熄灭蜡烛', 'ready');

        console.log('=== 系统初始化完成 ===');
        console.log('标准手势峰值速度:', standardGesture.speedProfile.peakSpeed);
        console.log('标准手势平均速度:', standardGesture.speedProfile.avgSpeed);
        console.log('综合阈值:', CONFIG.combinedThreshold);
        console.log('================');

    } catch (error) {
        console.error('MediaPipe initialization error:', error);
        updateStatus('初始化失败: ' + error.message, 'error');
    }
}

// ============================================================================
// MEDIAPIPE RESULTS HANDLER
// ============================================================================
function onResults(results) {
    if (!isInitialized || !standardGesture) return;

    const handCount = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
    const hasHand = handCount > 0;
    const hasTwoHands = handCount >= 2;

    // Rearm gate: after one action is evaluated, require brief disengage before next action.
    if (requireRearm) {
        if (!hasHand) {
            rearmCounter++;
        } else {
            rearmCounter = 0;
        }
        if (rearmCounter >= REARM_FRAMES) {
            requireRearm = false;
            rearmCounter = 0;
            updateStatus('Rearmed. Ready for next action.', 'ready');
        } else {
            updateStatus('Please lower hands to rearm...', 'waiting');
        }
        if (testMode && !hasHand) {
            ctxOutput.clearRect(0, 0, canvasOutput.width, canvasOutput.height);
        }
        return;
    }

    if (testMode && !hasHand) {
        ctxOutput.clearRect(0, 0, canvasOutput.width, canvasOutput.height);
    }
    pushDetectionQuality(hasHand);

    // Any-hand stabilization
    if (hasHand) {
        handPresenceCounter++;
        handLostCounter = 0;
    } else {
        handLostCounter++;
        handPresenceCounter = 0;
    }
    const handStableNow = handPresenceCounter >= HAND_PRESENCE_THRESHOLD;
    const handLostNow = handLostCounter >= HAND_LOST_THRESHOLD;

    if (handStableNow !== handStable) {
        handStable = handStableNow;
        logSuppressed = false;
    }

    if (!hasHand && dualPoseLocked && trajectoryCollector.getTrajectory().length > 0) {
        // Bridge complete hand dropouts for a short window.
        noHandGraceCounter++;
        addBridgePoint(Date.now());
        updateStatus('手部短暂丢失，正在补点连接...', 'waiting');

        if (noHandGraceCounter <= NO_HAND_GRACE_FRAMES) {
            return;
        }

        const trajectoryOnLost = trajectoryCollector.getTrajectory();
        const now = Date.now();
        if (
            trajectoryOnLost.length >= CONFIG.minGestureFrames &&
            now - lastMatchTime > matchCooldown &&
            now - lastEvaluationTime >= EVAL_INTERVAL_MS
        ) {
            evaluateCurrentTrajectory(trajectoryOnLost, 'no_hand_timeout');
        }
        resetTrackingState();
        return;
    }
    if (hasHand) {
        noHandGraceCounter = 0;
    }

    if (handLostNow && trajectoryCollector.getTrajectory().length > 0) {
        const trajectoryOnLost = trajectoryCollector.getTrajectory();
        const now = Date.now();
        if (
            trajectoryOnLost.length >= CONFIG.minGestureFrames &&
            now - lastMatchTime > matchCooldown &&
            now - lastEvaluationTime >= EVAL_INTERVAL_MS
        ) {
            evaluateCurrentTrajectory(trajectoryOnLost, 'hand_lost');
        }
        resetTrackingState();
        return;
    }

    if (!handStableNow) return;

    const landmarksList = results.multiHandLandmarks || [];
    const reliableTwoHands = hasReliableTwoHands(results);
    const landmarksA = landmarksList[0] || null;
    const landmarksB = landmarksList[1] || null;
    const endpointHand = pickEndpointHandLandmarks(results);

    if (testMode && hasHand) {
        drawHandSkeleton(landmarksB ? [landmarksA, landmarksB] : [landmarksA]);
    }

    const phaseAPoseMatchedNow = reliableTwoHands && landmarksList.some((landmarks) => isTargetHandPose(landmarks));

    if (!dualPoseLocked) {
        if (phaseAPoseMatchedNow) {
            posePresenceCounter++;
            poseLostCounter = 0;
        } else {
            poseLostCounter++;
            posePresenceCounter = 0;
        }

        const poseStableNow = posePresenceCounter >= POSE_PRESENCE_THRESHOLD;
        const poseLostNow = poseLostCounter >= POSE_LOST_THRESHOLD;
        if (poseStableNow !== poseStable) {
            poseStable = poseStableNow;
            console.log('Phase-A pose stable:', poseStableNow ? 'yes' : 'no');
        }

        if (!poseStableNow) {
            if (poseLostNow && trajectoryCollector.getTrajectory().length > 0) {
                addBridgePoint(Date.now());
            }
            updateStatus('Please keep both hands and complete flower phase', 'waiting');
            return;
        }

        dualPoseLocked = true;
        phaseBEntered = false;
        singleHandPhaseCounter = 0;
    } else if (phaseAPoseMatchedNow) {
        // Still seeing phase-A posture; keep the trajectory continuous.
        poseLostCounter = 0;
        singleHandPhaseCounter = 0;
    } else {
        poseLostCounter++;
        const dominantGhostTwoHands = handCount >= 2 && isEndpointHandDominant(results, PHASE_B_GHOST_DOMINANT_Z_GAP);
        if (handCount === 1 || dominantGhostTwoHands) {
            singleHandPhaseCounter++;
            if (singleHandPhaseCounter >= PHASE_B_MIN_SINGLE_HAND_FRAMES) {
                phaseBEntered = true;
            }
        } else {
            singleHandPhaseCounter = 0;
        }
    }

    dualPoseFrameCounter++;
    const endpointPhaseReady =
        dualPoseLocked &&
        phaseBEntered &&
        dualPoseFrameCounter >= DUAL_POSE_MIN_FRAMES_BEFORE_ENDPOINT &&
        trajectoryCollector.getDuration() >= Math.max(280, Math.floor((CONFIG.minGestureDurationMs || 0) * 0.6)) &&
        trajectoryCollector.getTrajectory().length >= CONFIG.minGestureFrames + 2;
    const endpointAllowedByHandState =
        handCount === 1 || (handCount >= 2 && isEndpointHandDominant(results, PHASE_B_GHOST_DOMINANT_Z_GAP));
    const endpointNow =
        endpointPhaseReady &&
        endpointAllowedByHandState &&
        isEndpointPointingPose(endpointHand);
    if (endpointNow) {
        endpointPosePresenceCounter++;
        endpointPoseLostCounter = 0;
    } else {
        endpointPoseLostCounter++;
        endpointPosePresenceCounter = 0;
    }
    endpointPoseStable = endpointPosePresenceCounter >= ENDPOINT_POSE_PRESENCE_THRESHOLD
        && endpointPoseLostCounter < ENDPOINT_POSE_LOST_THRESHOLD;
    if (endpointPoseStable) {
        endpointSeenInAction = true;
    } else if (!phaseBEntered) {
        updateStatus('Phase A done. Raise only right hand and point forward.', 'waiting');
    }

    const anchorHand = endpointHand || landmarksA;
    if (!anchorHand) return;

    const indexTipA = anchorHand[8];
    const middleTipA = anchorHand[12];
    const timestamp = Date.now();

    // Use hand A as the matching trajectory anchor.
    // Rationale: current learned standard was trained from single-anchor trajectories.
    const handAX = (indexTipA.x + middleTipA.x) / 2;
    const handAY = (indexTipA.y + middleTipA.y) / 2;
    const fusedX = handAX;
    const fusedY = handAY;
    trajectoryCollector.addPoint(fusedX, fusedY, timestamp);
    lastFusedPoint = { x: fusedX, y: fusedY };

    const trajectory = trajectoryCollector.getTrajectory();
    const isIdle = trajectoryCollector.isIdle();
    const trajectoryLength = trajectory.length;

    if (isIdle !== lastIdleState) {
        lastIdleState = isIdle;
        logSuppressed = false;
    }

    if (
        trajectoryLength === 1 ||
        (trajectoryLength >= 15 && trajectoryLength % 15 === 0) ||
        Math.abs(trajectoryLength - lastTrajectoryLength) >= 15
    ) {
        lastTrajectoryLength = trajectoryLength;
    }

    if (debugVisible) {
        document.getElementById('debugPoints').textContent = trajectoryLength;
    }

    if (trajectoryLength >= CONFIG.minGestureFrames) {
        const now = Date.now();
        if (now - lastMatchTime > matchCooldown && now - lastEvaluationTime >= EVAL_INTERVAL_MS) {
            // Fast actions may never appear fully idle; allow periodic eval too.
            const duration = trajectoryCollector.getDuration();
            const progressEval =
                trajectoryLength >= CONFIG.minGestureFrames + 4 &&
                duration >= CONFIG.minGestureDurationMs &&
                trajectoryLength % 8 === 0;
            if (isIdle || progressEval) {
                const reason = isIdle ? 'idle' : 'progress';
                const evalOutcome = evaluateCurrentTrajectory(trajectory, reason);
                if (evalOutcome.matched) return;

                if (!evalOutcome.matched && trajectoryCollector.idleFrameCount > CONFIG.idleFrames + 25) {
                    resetTrackingState();
                }
            }
        }
    }
}


// ============================================================================
// EVENT HANDLERS
// ============================================================================
debugToggle.addEventListener('click', () => {
    debugVisible = !debugVisible;
    if (debugVisible) {
        debugPanel.classList.add('visible');
        debugToggle.textContent = '🔧 关闭调试';
        updateDebugInfo();
    } else {
        debugPanel.classList.remove('visible');
        debugToggle.textContent = '🔧 调试';
    }
});

if (testModeToggle) {
    testModeToggle.addEventListener('click', () => {
        setTestMode(!testMode);
    });
}

btnReset.addEventListener('click', () => {
    candleRenderer.start();
    lastMatchTime = 0;
    requireRearm = false;
    rearmCounter = 0;
    resetTrackingState();
    updateStatus('🕯️ 已就绪 - 做点穴动作熄灭蜡烛', 'ready');
});

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initializeMediaPipe();
});
