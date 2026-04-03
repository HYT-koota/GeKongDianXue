const path = require("path");
const fs = require("fs");
const { loadShared, loadEmbeddedStandardGesture } = require("./lib/load_shared");

const projectRoot = path.resolve(__dirname, "..");
const { CONFIG, GestureMatcher } = loadShared(projectRoot);
const standard = loadEmbeddedStandardGesture(projectRoot);
const TEST_CONFIG = { ...CONFIG, debugSpeedCheck: false };

function toRawFromNormalized(norm, options = {}) {
  const {
    offsetX = 0.5,
    offsetY = 0.5,
    scale = 0.8,
    dt = 33,
    jitter = 0
  } = options;
  return norm.map((p, idx) => {
    const jx = (Math.random() * 2 - 1) * jitter;
    const jy = (Math.random() * 2 - 1) * jitter;
    return {
      x: p.x * scale + offsetX + jx,
      y: p.y * scale + offsetY + jy,
      timestamp: idx * dt
    };
  });
}

function randomTrajectory(points = 60, dt = 33) {
  const out = [];
  let x = Math.random();
  let y = Math.random();
  for (let i = 0; i < points; i++) {
    x = Math.min(1, Math.max(0, x + (Math.random() * 2 - 1) * 0.25));
    y = Math.min(1, Math.max(0, y + (Math.random() * 2 - 1) * 0.25));
    out.push({ x, y, timestamp: i * dt });
  }
  return out;
}

function evaluateSet(label, trajectories, matcher) {
  const rows = trajectories.map((t) => matcher.evaluate(t, standard));
  const matched = rows.filter((r) => r.isMatched).length;
  const avgConf = rows.reduce((s, r) => s + r.confidence, 0) / rows.length;
  return {
    label,
    total: rows.length,
    matched,
    matchRate: matched / rows.length,
    avgConf
  };
}

function main() {
  const matcher = new GestureMatcher(TEST_CONFIG);
  let positives = [];
  let negatives = [];
  let source = "synthetic";

  const posPath = path.join(projectRoot, "tests", "videos", "features", "trajectories.json");
  const negNormalPath = path.join(projectRoot, "tests", "videos", "features", "trajectories_neg_normal.json");
  const negHardPath = path.join(projectRoot, "tests", "videos", "features", "trajectories_neg_hard.json");
  if (fs.existsSync(posPath) && fs.existsSync(negNormalPath) && fs.existsSync(negHardPath)) {
    const posItems = (JSON.parse(fs.readFileSync(posPath, "utf8")).items || []).filter((x) => x.label === "1");
    const negItems = [
      ...(JSON.parse(fs.readFileSync(negNormalPath, "utf8")).items || []),
      ...(JSON.parse(fs.readFileSync(negHardPath, "utf8")).items || [])
    ].filter((x) => x.label === "0");
    positives = posItems.map((x) => x.smoothed_points || []).filter((x) => x.length > 0);
    negatives = negItems.map((x) => x.smoothed_points || []).filter((x) => x.length > 0);
    if (positives.length && negatives.length) {
      source = "labeled-features";
    }
  }

  if (!positives.length || !negatives.length) {
    positives = [
      toRawFromNormalized(standard.normalizedTrajectory, { jitter: 0.005 }),
      toRawFromNormalized(standard.normalizedTrajectory, { scale: 0.7, offsetX: 0.45, offsetY: 0.55, jitter: 0.01 }),
      toRawFromNormalized(standard.normalizedTrajectory, { scale: 0.85, offsetX: 0.55, offsetY: 0.5, dt: 28, jitter: 0.008 }),
      toRawFromNormalized(standard.normalizedTrajectory, { scale: 0.75, offsetX: 0.48, offsetY: 0.52, dt: 40, jitter: 0.012 })
    ];
    negatives = Array.from({ length: 12 }, () => randomTrajectory(60, 33));
    source = "synthetic";
  }

  const posRes = evaluateSet("positive", positives, matcher);
  const negRes = evaluateSet("negative", negatives, matcher);

  const falsePositiveRate = negRes.matchRate;
  const falseNegativeRate = 1 - posRes.matchRate;

  console.log("=== Offline Matcher Test ===");
  console.log(`Dataset: ${source}`);
  console.log(`Threshold(combined): ${TEST_CONFIG.combinedThreshold}`);
  console.log(
    `Positives: ${posRes.matched}/${posRes.total}, matchRate=${(posRes.matchRate * 100).toFixed(1)}%, avgConf=${posRes.avgConf.toFixed(3)}`
  );
  console.log(
    `Negatives: ${negRes.matched}/${negRes.total}, falsePositiveRate=${(falsePositiveRate * 100).toFixed(1)}%, avgConf=${negRes.avgConf.toFixed(3)}`
  );
  console.log(`FalseNegativeRate: ${(falseNegativeRate * 100).toFixed(1)}%`);

  if (posRes.matchRate >= 0.75 && falsePositiveRate <= 0.35) {
    console.log("Result: PASS");
    return;
  }
  console.log("Result: WARN (current thresholds are very permissive; use sweep + real video labels to tune)");
}

main();
