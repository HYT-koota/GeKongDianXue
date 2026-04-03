const fs = require("fs");
const path = require("path");
const { loadShared, loadEmbeddedStandardGesture } = require("./lib/load_shared");

const projectRoot = path.resolve(__dirname, "..");
const { CONFIG, GestureMatcher } = loadShared(projectRoot);
const standard = loadEmbeddedStandardGesture(projectRoot);

function toRawFromNormalized(norm, options = {}) {
  const {
    offsetX = 0.5,
    offsetY = 0.5,
    scale = 0.8,
    dt = 33,
    jitter = 0.01
  } = options;
  return norm.map((p, idx) => ({
    x: p.x * scale + offsetX + (Math.random() * 2 - 1) * jitter,
    y: p.y * scale + offsetY + (Math.random() * 2 - 1) * jitter,
    timestamp: idx * dt
  }));
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

function loadLabeledDatasets() {
  const posPath = path.join(projectRoot, "tests", "videos", "features", "trajectories.json");
  const negNormalPath = path.join(projectRoot, "tests", "videos", "features", "trajectories_neg_normal.json");
  const negHardPath = path.join(projectRoot, "tests", "videos", "features", "trajectories_neg_hard.json");

  if (!fs.existsSync(posPath) || !fs.existsSync(negNormalPath) || !fs.existsSync(negHardPath)) {
    return null;
  }

  const posItems = (JSON.parse(fs.readFileSync(posPath, "utf8")).items || []).filter((x) => x.label === "1");
  const negNormal = (JSON.parse(fs.readFileSync(negNormalPath, "utf8")).items || []).filter((x) => x.label === "0");
  const negHard = (JSON.parse(fs.readFileSync(negHardPath, "utf8")).items || []).filter((x) => x.label === "0");

  const positives = posItems.map((x) => x.smoothed_points || []).filter((x) => x.length > 0);
  const negatives = [...negNormal, ...negHard].map((x) => x.smoothed_points || []).filter((x) => x.length > 0);

  if (!positives.length || !negatives.length) return null;
  return { positives, negatives, source: "labeled-features" };
}

function makeSyntheticDatasets() {
  const positives = [];
  for (let i = 0; i < 20; i++) {
    positives.push(
      toRawFromNormalized(standard.normalizedTrajectory, {
        scale: 0.65 + Math.random() * 0.25,
        offsetX: 0.4 + Math.random() * 0.2,
        offsetY: 0.4 + Math.random() * 0.2,
        dt: 24 + Math.floor(Math.random() * 20),
        jitter: 0.004 + Math.random() * 0.015
      })
    );
  }
  const negatives = Array.from({ length: 40 }, () => randomTrajectory(60, 33));
  return { positives, negatives, source: "synthetic" };
}

function evaluate(matcher, standardGesture, positives, negatives) {
  const pHit = positives.filter((t) => matcher.evaluate(t, standardGesture).isMatched).length;
  const nHit = negatives.filter((t) => matcher.evaluate(t, standardGesture).isMatched).length;
  const tpr = pHit / positives.length;
  const fpr = nHit / negatives.length;
  return { tpr, fpr, score: tpr - fpr };
}

function main() {
  const datasets = loadLabeledDatasets() || makeSyntheticDatasets();
  const { positives, negatives, source } = datasets;

  const combinedValues = [0.34, 0.38, 0.4, 0.42, 0.44, 0.46, 0.48, 0.5];
  const minPeakValues = [0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
  const minAvgValues = [0.25, 0.3, 0.35, 0.4, 0.45];
  const results = [];

  for (const combinedThreshold of combinedValues) {
    for (const minPeakSpeedRatio of minPeakValues) {
      for (const minAvgSpeedRatio of minAvgValues) {
        const cfg = {
          ...CONFIG,
          combinedThreshold,
          minPeakSpeedRatio,
          minAvgSpeedRatio,
          debugSpeedCheck: false
        };
        const matcher = new GestureMatcher(cfg);
        const r = evaluate(matcher, standard, positives, negatives);
        results.push({ combinedThreshold, minPeakSpeedRatio, minAvgSpeedRatio, ...r });
      }
    }
  }

  results.sort((a, b) => b.score - a.score || a.fpr - b.fpr || b.tpr - a.tpr);
  const best = results[0];

  console.log(`=== Threshold Sweep (${source}) ===`);
  console.log(`positive samples=${positives.length}, negative samples=${negatives.length}`);
  console.log("=== Top 10 ===");
  results.slice(0, 10).forEach((r, i) => {
    console.log(
      `#${i + 1} combined=${r.combinedThreshold.toFixed(2)}, minPeak=${r.minPeakSpeedRatio.toFixed(2)}, minAvg=${r.minAvgSpeedRatio.toFixed(2)} | TPR=${(r.tpr * 100).toFixed(1)}% FPR=${(r.fpr * 100).toFixed(1)}% score=${r.score.toFixed(3)}`
    );
  });

  console.log("\n=== Recommended ===");
  console.log(JSON.stringify(best, null, 2));
}

main();
