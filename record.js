// ============================================================================
// GLOBAL STATE FOR RECORDING
// ============================================================================
let hands = null;
let camera = null;
let isInitialized = false;
let isRecording = false;

// Recording state
let recordings = []; // Array of { normalizedTrajectory, speedProfile, originalTrajectory }
let trajectoryCollector = new TrajectoryCollector(CONFIG);

// DOM Elements
const videoElement = document.getElementById('videoElement');
const canvasOutput = document.getElementById('canvasOutput');
const ctxOutput = canvasOutput.getContext('2d');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnFinish = document.getElementById('btnFinish');
const btnReset = document.getElementById('btnReset');
const statusEl = document.getElementById('status');
const recordCountEl = document.getElementById('recordCount');
const progressFillEl = document.getElementById('progressFill');
const targetCountInput = document.getElementById('targetCount');
const statsEl = document.getElementById('stats');
const dataSection = document.getElementById('dataSection');
const dataTableBody = document.getElementById('dataTableBody');
const btnExport = document.getElementById('btnExport');

// ============================================================================
// STATUS DISPLAY
// ============================================================================
function updateStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
}

function updateProgress() {
    const count = recordings.length;
    const target = parseInt(targetCountInput.value) || 15;
    const progress = Math.min(100, (count / target) * 100);

    recordCountEl.textContent = count;
    progressFillEl.style.width = progress + '%';

    // Enable finish button if we have at least 5 recordings
    btnFinish.disabled = count < 5;

    // Update stats if we have recordings
    if (count > 0) {
        updateStats();
        statsEl.style.display = 'block';
        dataSection.style.display = 'block';
    } else {
        dataSection.style.display = 'none';
    }

    // Update data table
    updateDataTable();
}

function updateDataTable() {
    dataTableBody.innerHTML = '';

    recordings.forEach((recording, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${recording.originalTrajectory.length}</td>
            <td>${recording.speedProfile.peakSpeed.toFixed(3)}</td>
            <td>${recording.speedProfile.avgSpeed.toFixed(3)}</td>
            <td><span class="delete-btn" onclick="deleteRecording(${index})">删除</span></td>
        `;
        dataTableBody.appendChild(row);
    });
}

// Global function for delete button
window.deleteRecording = function(index) {
    if (confirm(`确定要删除第 ${index + 1} 次录制吗？`)) {
        recordings.splice(index, 1);
        updateProgress();
    }
};

function updateStats() {
    if (recordings.length === 0) return;

    // Calculate averages
    const avgSpeedProfile = GestureAverager.averageSpeedProfiles(
        recordings.map(r => r.speedProfile)
    );

    const speedBuffer = GestureAverager.calculateSpeedBuffer(
        recordings.map(r => r.speedProfile),
        CONFIG
    );

    // Average point count
    const avgPoints = recordings.reduce((sum, r) => sum + r.originalTrajectory.length, 0) / recordings.length;

    document.getElementById('statPoints').textContent = avgPoints.toFixed(1);
    document.getElementById('statPeakSpeed').textContent = avgSpeedProfile.peakSpeed.toFixed(3);
    document.getElementById('statAvgSpeed').textContent = avgSpeedProfile.avgSpeed.toFixed(3);
    document.getElementById('statPeakStd').textContent = speedBuffer.peakStdDev.toFixed(3);
    document.getElementById('statAvgStd').textContent = speedBuffer.avgStdDev.toFixed(3);
}

// ============================================================================
// MEDIAPIPE INITIALIZATION
// ============================================================================
async function initializeMediaPipe() {
    updateStatus('正在初始化 MediaPipe Hands...', 'warning');

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

        // Initialize Camera
        camera = new Camera(videoElement, {
            onFrame: async () => {
                await hands.send({ image: videoElement });
            },
            width: 480,
            height: 360
        });

        await camera.start();

        // Setup output canvas
        canvasOutput.width = 480;
        canvasOutput.height = 360;

        isInitialized = true;
        updateStatus('已就绪！点击"开始录制本次动作"开始录制', 'success');
        btnStart.disabled = false;

    } catch (error) {
        console.error('MediaPipe initialization error:', error);
        updateStatus('初始化失败: ' + error.message, 'warning');
    }
}

// ============================================================================
// MEDIAPIPE RESULTS HANDLER
// ============================================================================
function onResults(results) {
    // Clear output canvas
    ctxOutput.clearRect(0, 0, canvasOutput.width, canvasOutput.height);

    // Draw hand landmarks
    if (results.multiHandLandmarks && results.multiHandLandmarks.length >= 2) {
        const landmarksA = results.multiHandLandmarks[0];
        const landmarksB = results.multiHandLandmarks[1];
        [landmarksA, landmarksB].forEach((landmarks) => {
            drawConnectors(ctxOutput, landmarks, HAND_CONNECTIONS, {
                color: '#00ff00',
                lineWidth: 2
            });
            drawLandmarks(ctxOutput, landmarks, {
                color: '#ff0000',
                lineWidth: 1,
                radius: 3
            });
        });

        const indexTipA = landmarksA[8];
        const middleTipA = landmarksA[12];
        const indexTipB = landmarksB[8];
        const middleTipB = landmarksB[12];
        const x = ((indexTipA.x + middleTipA.x) / 2 + (indexTipB.x + middleTipB.x) / 2) / 2;
        const y = ((indexTipA.y + middleTipA.y) / 2 + (indexTipB.y + middleTipB.y) / 2) / 2;
        const timestamp = Date.now();

        if (isRecording) {
            trajectoryCollector.addPoint(x, y, timestamp);

            // 实时显示轨迹点数
            const points = trajectoryCollector.getTrajectory().length;
            updateStatus(`正在录制... 轨迹点数: ${points} (点击"停止录制"结束)`, 'recording');
        }

        // Draw trajectory on output canvas
        drawTrajectory(ctxOutput, trajectoryCollector.getTrajectory());
    }

    // 绘制当前轨迹（包括未录制时）
}

// Draw trajectory on canvas
function drawTrajectory(ctx, trajectory) {
    if (trajectory.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
    ctx.lineWidth = 3;

    for (let i = 0; i < trajectory.length; i++) {
        const x = trajectory[i].x * canvasOutput.width;
        const y = trajectory[i].y * canvasOutput.height;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.stroke();

    // Draw start and end points
    if (trajectory.length > 0) {
        const start = trajectory[0];
        ctx.beginPath();
        ctx.arc(start.x * canvasOutput.width, start.y * canvasOutput.height, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#00ff00';
        ctx.fill();

        const end = trajectory[trajectory.length - 1];
        ctx.beginPath();
        ctx.arc(end.x * canvasOutput.width, end.y * canvasOutput.height, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff0000';
        ctx.fill();
    }
}

// ============================================================================
// RECORDING FUNCTIONS
// ============================================================================
function startRecording() {
    if (!isInitialized) return;

    isRecording = true;
    trajectoryCollector.reset();
    btnStart.disabled = true;
    btnStop.disabled = false;
    btnFinish.disabled = true;
    btnReset.disabled = true;
    targetCountInput.disabled = true;

    updateStatus('开始录制！请做点穴动作，动作完成后点击"停止录制"', 'recording');
}

function stopRecording() {
    if (!isRecording) return;

    const trajectory = trajectoryCollector.getTrajectory();

    if (trajectory.length >= CONFIG.minPoints) {
        const speedProfile = SpeedDetector.analyze(trajectory, CONFIG);
        updateStatus(`已保存 ${trajectory.length} 点 (峰值速度: ${speedProfile.peakSpeed.toFixed(3)}`, 'success');
        saveRecording(trajectory);
    } else {
        updateStatus(`轨迹太短 (${trajectory.length}点)，未保存`, 'warning');
    }

    isRecording = false;
    trajectoryCollector.reset();
    btnStart.disabled = false;
    btnStop.disabled = true;
    btnFinish.disabled = recordings.length < 5;
    btnReset.disabled = false;
    targetCountInput.disabled = false;
}

function finishRecording() {
    const trajectory = trajectoryCollector.getTrajectory();

    if (trajectory.length >= CONFIG.minPoints) {
        saveRecording(trajectory);
    } else {
        updateStatus(`轨迹太短 (${trajectory.length}点)，未保存`, 'warning');
    }

    isRecording = false;
    trajectoryCollector.reset();
    btnStart.disabled = false;
    btnStop.disabled = true;
    btnFinish.disabled = true;
    btnReset.disabled = false;
    targetCountInput.disabled = false;
}

function saveRecording(trajectory) {
    // Normalize trajectory
    const normalizedTrajectory = TrajectoryNormalizer.normalize(trajectory);

    // Extract speed features
    const speedProfile = SpeedDetector.analyze(trajectory, CONFIG);

    // Save recording
    recordings.push({
        normalizedTrajectory,
        speedProfile,
        originalTrajectory: trajectory.slice()
    });

    updateProgress();

    const target = parseInt(targetCountInput.value) || 15;
    const count = recordings.length;

    if (count >= target) {
        // Wait a bit then show completion message
        setTimeout(() => {
            updateStatus(`录制完成！已录制 ${count} 次，点击"完成录制"保存标准`, 'success');
        }, 1500);
    }
}

function finishAndSave() {
    if (recordings.length < 5) {
        updateStatus('至少需要录制 5 次才能保存', 'warning');
        return;
    }

    updateStatus('正在计算平均值...', 'warning');

    // Calculate average normalized trajectory
    const avgNormalizedTrajectory = GestureAverager.averageNormalizedTrajectories(
        recordings.map(r => r.normalizedTrajectory),
        50 // Target length for averaging
    );

    // Calculate average speed profile
    const avgSpeedProfile = GestureAverager.averageSpeedProfiles(
        recordings.map(r => r.speedProfile)
    );

    // Calculate speed buffer (for margin in matching)
    const speedBuffer = GestureAverager.calculateSpeedBuffer(
        recordings.map(r => r.speedProfile),
        CONFIG
    );

    // Create standard gesture
    const standardGesture = {
        normalizedTrajectory: avgNormalizedTrajectory,
        speedProfile: avgSpeedProfile,
        speedBuffer: speedBuffer,
        recordingCount: recordings.length,
        createdAt: Date.now()
    };

    // Save to localStorage
    localStorage.setItem('standardGesture', JSON.stringify(standardGesture));

    updateStatus(`✅ 标准手势已保存！共录制 ${recordings.length} 次`, 'success');
    alert(`标准手势已保存！\n\n录制次数: ${recordings.length}\n\n【中位数标准】\n峰值速度: ${avgSpeedProfile.peakSpeed.toFixed(3)}\n平均速度: ${avgSpeedProfile.avgSpeed.toFixed(3)}\n\n注意：标准手势使用中位数计算，对异常值更鲁棒。\n\n点击"前往主页面"开始使用！`);
}

function resetRecordings() {
    if (recordings.length > 0 &&
        !confirm('确定要清除所有录制数据吗？')) {
        return;
    }

    recordings = [];
    trajectoryCollector.reset();
    updateProgress();
    statsEl.style.display = 'none';
    dataSection.style.display = 'none';
    updateStatus('已重置', 'warning');
}

// ============================================================================
// EXPORT FUNCTIONALITY
// ============================================================================
function exportData() {
    if (recordings.length === 0) {
        alert('没有数据可导出');
        return;
    }

    // Calculate statistics
    const avgSpeedProfile = GestureAverager.averageSpeedProfiles(
        recordings.map(r => r.speedProfile)
    );

    const speedBuffer = GestureAverager.calculateSpeedBuffer(
        recordings.map(r => r.speedProfile),
        CONFIG
    );

    const avgPoints = recordings.reduce((sum, r) => sum + r.originalTrajectory.length, 0) / recordings.length;

    // Create export data
    const exportData = {
        exportTime: new Date().toISOString(),
        recordingCount: recordings.length,
        statistics: {
            avgPointCount: avgPoints,
            avgPeakSpeed: avgSpeedProfile.peakSpeed,
            avgAvgSpeed: avgSpeedProfile.avgSpeed,
            peakSpeedStdDev: speedBuffer.peakStdDev,
            avgSpeedStdDev: speedBuffer.avgStdDev
        },
        config: {
            minPoints: CONFIG.minPoints,
            maxPoints: CONFIG.maxPoints,
            minPeakSpeedRatio: CONFIG.minPeakSpeedRatio,
            minAvgSpeedRatio: CONFIG.minAvgSpeedRatio,
            combinedThreshold: CONFIG.combinedThreshold,
            similarityThreshold: CONFIG.similarityThreshold
        },
        recordings: recordings.map((r, i) => ({
            id: i + 1,
            pointCount: r.originalTrajectory.length,
            peakSpeed: r.speedProfile.peakSpeed,
            avgSpeed: r.speedProfile.avgSpeed,
            // Don't include full trajectory to keep file size manageable
            trajectorySample: r.originalTrajectory.filter((_, i) => i % 5 === 0)
        }))
    };

    // Download as JSON file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gesture_data_${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    updateStatus('数据已导出', 'success');
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================
btnStart.addEventListener('click', startRecording);
btnStop.addEventListener('click', stopRecording);
btnFinish.addEventListener('click', finishAndSave);
btnReset.addEventListener('click', resetRecordings);
btnExport.addEventListener('click', exportData);

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initializeMediaPipe();
});
