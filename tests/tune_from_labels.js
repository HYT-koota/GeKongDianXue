const fs = require("fs");
const path = require("path");
const { loadShared, loadEmbeddedStandardGesture } = require("./lib/load_shared");

const projectRoot = path.resolve(__dirname, "..");
const { CONFIG, GestureMatcher } = loadShared(projectRoot);
const standard = loadEmbeddedStandardGesture(projectRoot);

function scoreConfig(cfg, items) {
  const matcher = new GestureMatcher(cfg);
  const rows = items.map((it) => {
    const r = matcher.evaluate(it.smoothed_points || [], standard);
    return { ...it, matched: r.isMatched ? 1 : 0, conf: r.confidence };
  });
  const pos = rows.filter((r) => r.label === "1");
  const neg = rows.filter((r) => r.label === "0");
  const fast = pos.filter((r) => (r.notes || "").includes("fast"));
  const slow = pos.filter((r) => (r.notes || "").includes("slow"));
  const tpr = pos.length ? pos.filter((r) => r.matched).length / pos.length : 0;
  const fpr = neg.length ? neg.filter((r) => r.matched).length / neg.length : 0;
  const tprFast = fast.length ? fast.filter((r) => r.matched).length / fast.length : 0;
  const tprSlow = slow.length ? slow.filter((r) => r.matched).length / slow.length : 0;
  const avgConf = pos.length ? pos.reduce((s, r) => s + r.conf, 0) / pos.length : 0;
  return { tpr, fpr, tprFast, tprSlow, avgConf };
}

function main() {
  const featurePath = path.join(projectRoot, "tests", "videos", "features", "trajectories.json");
  const data = JSON.parse(fs.readFileSync(featurePath, "utf8"));
  const posItems = (data.items || []).filter((x) => x.label === "1");
  const negNormalPath = path.join(projectRoot, "tests", "videos", "features", "trajectories_neg_normal.json");
  const negHardPath = path.join(projectRoot, "tests", "videos", "features", "trajectories_neg_hard.json");
  const negNormal = fs.existsSync(negNormalPath) ? JSON.parse(fs.readFileSync(negNormalPath, "utf8")).items || [] : [];
  const negHard = fs.existsSync(negHardPath) ? JSON.parse(fs.readFileSync(negHardPath, "utf8")).items || [] : [];
  const items = [...posItems, ...negNormal, ...negHard];

  const minPointsVals = [8, 10, 12, 15];
  const combinedVals = [0.34, 0.38, 0.4, 0.42, 0.44, 0.46, 0.48];
  const minSpeedVals = [0.25, 0.3, 0.35, 0.4, 0.45];
  const rows = [];

  for (const minPoints of minPointsVals) {
    for (const combinedThreshold of combinedVals) {
      for (const minPeakSpeedRatio of minSpeedVals) {
        for (const minAvgSpeedRatio of minSpeedVals) {
          const cfg = {
            ...CONFIG,
            debugSpeedCheck: false,
            minPoints,
            combinedThreshold,
            minPeakSpeedRatio,
            minAvgSpeedRatio
          };
          const s = scoreConfig(cfg, items);
          // Balance fast recall and false positives.
          const score = s.tprFast * 0.55 + s.tpr * 0.30 - s.fpr * 0.75;
          rows.push({
            minPoints,
            combinedThreshold,
            minPeakSpeedRatio,
            minAvgSpeedRatio,
            ...s,
            score
          });
        }
      }
    }
  }

  rows.sort((a, b) => b.score - a.score);
  console.log("=== Tune From Labeled Segments (Top 10) ===");
  rows.slice(0, 10).forEach((r, i) => {
    console.log(
      `#${i + 1} minPoints=${r.minPoints}, combined=${r.combinedThreshold.toFixed(2)}, peak=${r.minPeakSpeedRatio.toFixed(2)}, avg=${r.minAvgSpeedRatio.toFixed(2)} | TPR=${(r.tpr * 100).toFixed(1)}% FPR=${(r.fpr * 100).toFixed(1)}% fast=${(r.tprFast * 100).toFixed(1)}% slow=${(r.tprSlow * 100).toFixed(1)}%`
    );
  });

  const best = rows[0];
  console.log("\n=== Best Suggestion ===");
  console.log(JSON.stringify(best, null, 2));
}

main();
