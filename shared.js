// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
    // Trajectory collection
    minPoints: 8,                 // 更宽松：快速动作也能进入匹配
    minGestureFrames: 14,         // 稍收紧：降低“手花中途”误判
    minGestureDurationMs: 550,    // 要求最短有效动作时长，避免过早触发
    maxPoints: 500,               // 增加最大点数，允许更长的动作
    smoothingWindow: 5,           // 增加平滑窗口
    idleThreshold: 0.08,          // 增加到0.08，避免动作中的短暂停顿误判
    idleFrames: 16,               // 结束判定更灵敏，避免拖太久

    // Speed parameters
    minDistanceForSpeed: 0.02,    // 降低最小距离，两个手指动作幅度可能较小
    minPeakSpeedRatio: 0.40,      // 提高峰值速度门槛，减少负样本误触发
    minAvgSpeedRatio: 0.35,       // 进一步放宽平均速度，适配双手识别抖动

    // DTW parameters
    dtwWindowRatio: 0.4,          // 增加DTW窗口，允许更灵活的时间对齐
    positionalWeight: 0.5,
    directionalWeight: 0.3,
    curvatureWeight: 0.2,         // 增加曲率权重，两个手指动作可能更精细

    // Matching thresholds
    similarityThreshold: 0.45,    // 降低相似度阈值
    combinedThreshold: 0.44,      // 提高综合阈值，在保留召回时压缩误报

    // Averaging buffer/margin
    speedBufferRatio: 0,          // 移除缓冲区，直接使用阈值
    similarityBuffer: 0,          // 移除缓冲区

    // Debug
    debugSpeedCheck: true,        // 启用速度检查调试日志
};

// ============================================================================
// TRAJECTORY COLLECTOR
// ============================================================================
class TrajectoryCollector {
    constructor(config) {
        this.config = config;
        this.trajectory = [];
        this.smoothedPoints = [];
        this.lastPosition = null;
        this.idleFrameCount = 0;
    }

    addPoint(x, y, timestamp) {
        const point = { x, y, timestamp };
        this.trajectory.push(point);

        // Smoothing
        this.smoothedPoints = this._smoothTrajectory(this.trajectory);

        // Idle detection
        if (this.lastPosition) {
            const dx = x - this.lastPosition.x;
            const dy = y - this.lastPosition.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < this.config.idleThreshold) {
                this.idleFrameCount++;
            } else {
                this.idleFrameCount = 0;
            }
        }

        this.lastPosition = { x, y };
    }

    _smoothTrajectory(points) {
        if (points.length === 0) return [];

        const window = this.config.smoothingWindow;
        const smoothed = [];

        for (let i = 0; i < points.length; i++) {
            const start = Math.max(0, i - Math.floor(window / 2));
            const end = Math.min(points.length, i + Math.ceil(window / 2));

            let sumX = 0, sumY = 0, count = 0;
            for (let j = start; j < end; j++) {
                sumX += points[j].x;
                sumY += points[j].y;
                count++;
            }

            smoothed.push({
                x: sumX / count,
                y: sumY / count,
                timestamp: points[i].timestamp
            });
        }

        return smoothed;
    }

    isIdle() {
        return this.idleFrameCount >= this.config.idleFrames;
    }

    getTrajectory() {
        return this.smoothedPoints;
    }

    getRawTrajectory() {
        return this.trajectory;
    }

    getDuration() {
        if (this.trajectory.length < 2) return 0;
        const first = this.trajectory[0];
        const last = this.trajectory[this.trajectory.length - 1];
        return last.timestamp - first.timestamp; // 返回毫秒
    }

    getFrameCount() {
        return this.trajectory.length;
    }

    reset() {
        this.trajectory = [];
        this.smoothedPoints = [];
        this.lastPosition = null;
        this.idleFrameCount = 0;
    }
}

// ============================================================================
// TRAJECTORY NORMALIZER
// ============================================================================
class TrajectoryNormalizer {
    static normalize(trajectory) {
        if (trajectory.length === 0) return [];

        // Calculate bounding box
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const point of trajectory) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }

        // Calculate center and scale
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const scaleX = maxX - minX;
        const scaleY = maxY - minY;
        const maxScale = Math.max(scaleX, scaleY, 0.001); // Avoid division by zero

        // Normalize to unit square centered at (0, 0)
        const normalized = trajectory.map(point => ({
            x: (point.x - centerX) / maxScale,
            y: (point.y - centerY) / maxScale,
            timestamp: point.timestamp
        }));

        return normalized;
    }

    static normalizeToLength(trajectory, targetLength) {
        if (trajectory.length === 0) return [];
        if (targetLength <= 0) return trajectory.slice();

        // Resample trajectory to target length
        const resampled = [];
        const step = (trajectory.length - 1) / (targetLength - 1);

        for (let i = 0; i < targetLength; i++) {
            const index = Math.min(i * step, trajectory.length - 1);
            const lower = Math.floor(index);
            const upper = Math.ceil(index);
            const t = index - lower;

            if (lower === upper) {
                resampled.push(trajectory[lower]);
            } else {
                resampled.push({
                    x: trajectory[lower].x * (1 - t) + trajectory[upper].x * t,
                    y: trajectory[lower].y * (1 - t) + trajectory[upper].y * t,
                    timestamp: trajectory[lower].timestamp * (1 - t) + trajectory[upper].timestamp * t
                });
            }
        }

        return resampled;
    }
}

// ============================================================================
// ENHANCED DTW ALGORITHM
// ============================================================================
class EnhancedDTW {
    constructor(config) {
        this.config = config;
    }

    calculate(traj1, traj2) {
        const m = traj1.length;
        const n = traj2.length;

        if (m === 0 || n === 0) return Infinity;

        // Initialize DP matrix
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(Infinity));
        dp[0][0] = 0;

        // Sakoe-Chiba window
        const windowSize = Math.floor(this.config.dtwWindowRatio * Math.max(m, n));

        // Precompute directions for traj2
        const dirs2 = this._computeDirections(traj2);

        for (let i = 1; i <= m; i++) {
            // Precompute direction for traj1[i-1]
            let dir1 = null;
            if (i > 1) {
                dir1 = {
                    dx: traj1[i-1].x - traj1[i-2].x,
                    dy: traj1[i-1].y - traj1[i-2].y
                };
            }

            for (let j = 1; j <= n; j++) {
                // Check window constraint
                if (Math.abs(i - j) > windowSize) continue;

                // Calculate enhanced distance
                const dist = this._enhancedDistance(
                    traj1[i-1], traj2[j-1],
                    dir1, dirs2[j-1]
                );

                // DP recurrence
                dp[i][j] = dist + Math.min(
                    dp[i-1][j],    // insertion
                    dp[i][j-1],    // deletion
                    dp[i-1][j-1]   // match
                );
            }
        }

        // Find path length for normalization
        const pathLength = this._tracebackPathLength(dp, m, n);

        return dp[m][n] / pathLength;
    }

    _enhancedDistance(p1, p2, dir1, dir2) {
        // Position distance (60%)
        const posDist = Math.sqrt(
            Math.pow(p1.x - p2.x, 2) +
            Math.pow(p1.y - p2.y, 2)
        );

        // Direction distance (30%)
        let dirDist = 0;
        if (dir1 && dir2) {
            const mag1 = Math.sqrt(dir1.dx * dir1.dx + dir1.dy * dir1.dy);
            const mag2 = Math.sqrt(dir2.dx * dir2.dx + dir2.dy * dir2.dy);

            if (mag1 > 0 && mag2 > 0) {
                const dot = (dir1.dx * dir2.dx + dir1.dy * dir2.dy) / (mag1 * mag2);
                dirDist = Math.acos(Math.max(-1, Math.min(1, dot))) / Math.PI;
            }
        }

        // Curvature distance (10%)
        let curvDist = 0;
        // Simplified curvature (would need 3 points for proper calculation)

        // Weighted combination
        return (
            this.config.positionalWeight * posDist +
            this.config.directionalWeight * dirDist +
            this.config.curvatureWeight * curvDist
        );
    }

    _computeDirections(trajectory) {
        const dirs = [];
        for (let i = 0; i < trajectory.length; i++) {
            if (i === 0) {
                dirs.push({ dx: 0, dy: 0 });
            } else {
                dirs.push({
                    dx: trajectory[i].x - trajectory[i-1].x,
                    dy: trajectory[i].y - trajectory[i-1].y
                });
            }
        }
        return dirs;
    }

    _tracebackPathLength(dp, m, n) {
        let length = 0;
        let i = m, j = n;

        while (i > 0 && j > 0) {
            length++;
            const prev = Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);

            if (prev === dp[i-1][j-1]) {
                i--; j--;
            } else if (prev === dp[i-1][j]) {
                i--;
            } else {
                j--;
            }
        }

        return length || 1;
    }
}

// ============================================================================
// SPEED DETECTOR
// ============================================================================
class SpeedDetector {
    static analyze(trajectory, config) {
        if (trajectory.length < 2) {
            return { peakSpeed: 0, avgSpeed: 0, speeds: [] };
        }

        const speeds = [];
        let peakSpeed = 0;
        let totalSpeed = 0;
        const minDistance = config?.minDistanceForSpeed || 0.03;

        for (let i = 1; i < trajectory.length; i++) {
            const dx = trajectory[i].x - trajectory[i-1].x;
            const dy = trajectory[i].y - trajectory[i-1].y;
            const dt = (trajectory[i].timestamp - trajectory[i-1].timestamp) / 1000; // Convert to seconds

            let speed = 0;
            if (dt > 0) {
                const distance = Math.sqrt(dx * dx + dy * dy);
                // 忽略微小位移，避免检测噪声产生虚假速度
                if (distance >= minDistance) {
                    speed = distance / dt;
                }
                // 否则 speed = 0
            }
            speeds.push(speed);

            peakSpeed = Math.max(peakSpeed, speed);
            totalSpeed += speed;
        }

        return {
            peakSpeed,
            avgSpeed: speeds.length > 0 ? totalSpeed / speeds.length : 0,
            speeds
        };
    }

    // Calculate median for more robust statistics (less affected by outliers)
    static median(values) {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    static check(actual, standard, config) {
        if (!standard) return false;

        // Apply buffer/margin
        const buffer = 1 - config.speedBufferRatio; // e.g., 0.8 means 20% buffer

        const peakRatio = standard.peakSpeed > 0 ? actual.peakSpeed / standard.peakSpeed : 0;
        const avgRatio = standard.avgSpeed > 0 ? actual.avgSpeed / standard.avgSpeed : 0;

        const peakThreshold = config.minPeakSpeedRatio * buffer;
        const avgThreshold = config.minAvgSpeedRatio * buffer;

        // Debug logging (only in development)
        if (typeof console !== 'undefined' && config.debugSpeedCheck) {
            console.log('=== Speed Check Debug ===');
            console.log('Actual peak:', actual.peakSpeed?.toFixed(4), 'avg:', actual.avgSpeed?.toFixed(4));
            console.log('Standard peak:', standard.peakSpeed, 'avg:', standard.avgSpeed);
            console.log('Peak ratio:', peakRatio.toFixed(4), 'threshold:', peakThreshold);
            console.log('Avg ratio:', avgRatio.toFixed(4), 'threshold:', avgThreshold);
            console.log('Peak passed:', peakRatio >= peakThreshold);
            console.log('Avg passed:', avgRatio >= avgThreshold);
        }

        return (
            peakRatio >= peakThreshold &&
            avgRatio >= avgThreshold
        );
    }
}

// ============================================================================
// GESTURE AVERAGER
// ============================================================================
class GestureAverager {
    static averageNormalizedTrajectories(trajectories, targetLength = 50) {
        if (trajectories.length === 0) return [];

        // Normalize all trajectories to same length
        const resampled = trajectories.map(t =>
            TrajectoryNormalizer.normalizeToLength(t, targetLength)
        );

        // Average point by point
        const averaged = [];
        for (let i = 0; i < targetLength; i++) {
            let sumX = 0, sumY = 0, sumTime = 0;

            for (const traj of resampled) {
                sumX += traj[i].x;
                sumY += traj[i].y;
                sumTime += traj[i].timestamp;
            }

            averaged.push({
                x: sumX / resampled.length,
                y: sumY / resampled.length,
                timestamp: sumTime / resampled.length
            });
        }

        return averaged;
    }

    static averageSpeedProfiles(speedProfiles) {
        if (speedProfiles.length === 0) {
            return { peakSpeed: 0, avgSpeed: 0 };
        }

        // Use median for more robust statistics (less affected by outliers)
        const peakValues = speedProfiles.map(sp => sp.peakSpeed);
        const avgValues = speedProfiles.map(sp => sp.avgSpeed);

        return {
            peakSpeed: SpeedDetector.median(peakValues),
            avgSpeed: SpeedDetector.median(avgValues)
        };
    }

    static calculateSpeedBuffer(speedProfiles, config) {
        if (speedProfiles.length < 2) {
            return {
                peakBuffer: 0,
                avgBuffer: 0,
                peakStdDev: 0,
                avgStdDev: 0
            };
        }

        // Calculate standard deviation
        let sumPeak = 0, sumAvg = 0;
        for (const sp of speedProfiles) {
            sumPeak += sp.peakSpeed;
            sumAvg += sp.avgSpeed;
        }

        const meanPeak = sumPeak / speedProfiles.length;
        const meanAvg = sumAvg / speedProfiles.length;

        let sumSqDiffPeak = 0, sumSqDiffAvg = 0;
        for (const sp of speedProfiles) {
            sumSqDiffPeak += Math.pow(sp.peakSpeed - meanPeak, 2);
            sumSqDiffAvg += Math.pow(sp.avgSpeed - meanAvg, 2);
        }

        const stdDevPeak = Math.sqrt(sumSqDiffPeak / speedProfiles.length);
        const stdDevAvg = Math.sqrt(sumSqDiffAvg / speedProfiles.length);

        return {
            peakBuffer: meanPeak * config.speedBufferRatio,
            avgBuffer: meanAvg * config.speedBufferRatio,
            peakStdDev: stdDevPeak,
            avgStdDev: stdDevAvg
        };
    }
}

// ============================================================================
// GESTURE MATCHER
// ============================================================================
class GestureMatcher {
    constructor(config) {
        this.config = config;
        this.dtw = new EnhancedDTW(config);
        this.normalizer = TrajectoryNormalizer;
        this.speedDetector = SpeedDetector;
    }

    evaluate(currentTrajectory, standardGesture) {
        if (!standardGesture || !currentTrajectory || currentTrajectory.length < this.config.minPoints) {
            return {
                isMatched: false,
                confidence: 0,
                details: { similarityScore: 0, speedScore: 0 }
            };
        }

        // Normalize and align lengths to avoid DTW path failure on very different point counts.
        const normalizedCurrent = this.normalizer.normalize(currentTrajectory);
        const targetLength = Math.max(
            20,
            standardGesture.normalizedTrajectory?.length || normalizedCurrent.length
        );
        const alignedCurrent = this.normalizer.normalizeToLength(normalizedCurrent, targetLength);
        const alignedStandard = this.normalizer.normalizeToLength(
            standardGesture.normalizedTrajectory,
            targetLength
        );

        // Calculate DTW distance
        const dtwDistance = this.dtw.calculate(
            alignedCurrent,
            alignedStandard
        );

        // Similarity score (inverse of distance)
        const maxDistance = Math.sqrt(2); // Maximum possible distance in unit square
        const similarityScore = Math.max(0, 1 - dtwDistance / maxDistance);

        // Speed detection
        const currentSpeed = this.speedDetector.analyze(currentTrajectory, this.config);
        const speedMatched = this.speedDetector.check(
            currentSpeed,
            standardGesture.speedProfile,
            this.config
        );
        const speedScore = speedMatched ? 1 : 0;

        // Combined score
        const combinedScore = 0.5 * similarityScore + 0.5 * speedScore;

        return {
            isMatched: combinedScore >= this.config.combinedThreshold,
            confidence: combinedScore,
            details: { similarityScore, speedScore, dtwDistance, currentSpeed }
        };
    }
}

// ============================================================================
// CANDLE RENDERER
// ============================================================================
class CandleRenderer {
    constructor(canvas, ctx, container) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.container = container;
        this.isLit = true;
        this.flameIntensity = 1.0;
        this.particles = [];
        this.animationId = null;

        // Candle dimensions
        this.candleWidth = 40;
        this.candleHeight = 250;
        this.flameHeight = 140;
        this.flameWidth = 60;

        // Colors
        this.candleColor = '#FFD8A8';
        this.flameColors = [
            '#FFD700', // Gold
            '#FF8C00', // Dark orange
            '#FF4500'  // Orange red
        ];

        this.start();
    }

    start() {
        this.isLit = true;
        this.flameIntensity = 1.0;
        this.container.classList.add('lit');
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        this.animationId = requestAnimationFrame(() => this.render());
    }

    extinguish() {
        this.isLit = false;
        this.container.classList.remove('lit');

        // Create smoke particles
        const centerX = this.canvas.width / 2;
        const flameTop = (this.canvas.height - this.candleHeight) / 2 - this.flameHeight;

        for (let i = 0; i < 30; i++) {
            this.particles.push({
                x: centerX + (Math.random() - 0.5) * 20,
                y: flameTop + Math.random() * 10,
                vx: (Math.random() - 0.5) * 2,
                vy: -Math.random() * 3 - 1,
                radius: Math.random() * 4 + 2,
                alpha: Math.random() * 0.3 + 0.4,
                life: 100
            });
        }

        // Stop flame animation
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Render extinguished state
        this.render();
    }

    render() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Center position
        const centerX = width / 2;
        const candleBottom = (height + this.candleHeight) / 2;
        const candleTop = candleBottom - this.candleHeight;

        // Draw candle
        ctx.fillStyle = this.candleColor;
        ctx.fillRect(
            centerX - this.candleWidth / 2,
            candleTop,
            this.candleWidth,
            this.candleHeight
        );

        // Draw candle top (melted wax effect)
        ctx.fillStyle = '#FFC080';
        ctx.beginPath();
        ctx.ellipse(
            centerX,
            candleTop,
            this.candleWidth / 2 + 5,
            10,
            0, 0, Math.PI * 2
        );
        ctx.fill();

        // Draw flame if lit
        if (this.isLit) {
            const flameBottomY = candleTop - 5;
            const flameTopY = flameBottomY - this.flameHeight * this.flameIntensity;

            // Create flame gradient
            const gradient = ctx.createRadialGradient(
                centerX, flameTopY + this.flameHeight * 0.3 * this.flameIntensity, 0,
                centerX, flameTopY + this.flameHeight * 0.3 * this.flameIntensity, this.flameWidth * 0.6
            );

            gradient.addColorStop(0, this.flameColors[0]);
            gradient.addColorStop(0.5, this.flameColors[1]);
            gradient.addColorStop(1, this.flameColors[2]);

            // Draw flame
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(centerX, flameBottomY);
            ctx.bezierCurveTo(
                centerX + this.flameWidth / 2, flameBottomY - this.flameHeight * 0.2 * this.flameIntensity,
                centerX + this.flameWidth / 3, flameTopY,
                centerX, flameTopY
            );
            ctx.bezierCurveTo(
                centerX - this.flameWidth / 3, flameTopY,
                centerX - this.flameWidth / 2, flameBottomY - this.flameHeight * 0.2 * this.flameIntensity,
                centerX, flameBottomY
            );
            ctx.fill();

            // Flicker effect
            this.flameIntensity = 0.9 + Math.random() * 0.2;

            // Continue animation
            this.animationId = requestAnimationFrame(() => this.render());
        }

        // Render particles (smoke)
        if (this.particles.length > 0) {
            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];

                ctx.globalAlpha = p.alpha;
                ctx.fillStyle = 'rgba(100, 100, 100, 0.7)';
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fill();

                p.x += p.vx;
                p.y += p.vy;
                p.alpha *= 0.97;
                p.life--;

                if (p.life <= 0) {
                    this.particles.splice(i, 1);
                }
            }

            // Continue animation if there are particles
            if (this.particles.length > 0) {
                this.animationId = requestAnimationFrame(() => this.render());
            }
        }

        ctx.globalAlpha = 1.0;
    }
}
