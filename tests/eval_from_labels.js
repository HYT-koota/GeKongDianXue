const fs = require("fs");
const path = require("path");
const { loadShared, loadEmbeddedStandardGesture } = require("./lib/load_shared");

const projectRoot = path.resolve(__dirname, "..");
const { CONFIG, GestureMatcher } = loadShared(projectRoot);
const standard = loadEmbeddedStandardGesture(projectRoot);

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function main() {
  const featurePath = path.join(projectRoot, "tests", "videos", "features", "trajectories.json");
  if (!fs.existsSync(featurePath)) {
    console.error(`missing ${featurePath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(featurePath, "utf8"));
  const items = data.items || [];
  const matcher = new GestureMatcher({ ...CONFIG, debugSpeedCheck: false });

  const evalRows = [];
  for (const item of items) {
    if (!item.label) continue;
    const trajectory = item.smoothed_points || [];
    const result = matcher.evaluate(trajectory, standard);
    evalRows.push({
      ...item,
      matched: result.isMatched ? 1 : 0,
      confidence: result.confidence,
      similarity: result.details?.similarityScore ?? 0
    });
  }

  const pos = evalRows.filter((r) => r.label === "1");
  const neg = evalRows.filter((r) => r.label === "0");
  const fast = evalRows.filter((r) => r.notes.includes("fast"));
  const slow = evalRows.filter((r) => r.notes.includes("slow"));

  const posTPR = pos.length ? pos.filter((r) => r.matched === 1).length / pos.length : 0;
  const negFPR = neg.length ? neg.filter((r) => r.matched === 1).length / neg.length : 0;

  console.log("=== Evaluation On Labeled Segments ===");
  console.log(`threshold(combined): ${CONFIG.combinedThreshold}`);
  console.log(`labeled samples: ${evalRows.length}`);
  console.log(`positive samples: ${pos.length}, TPR: ${(posTPR * 100).toFixed(1)}%`);
  console.log(`negative samples: ${neg.length}, FPR: ${(negFPR * 100).toFixed(1)}%`);
  console.log(`avg confidence(all): ${mean(evalRows.map((r) => r.confidence)).toFixed(3)}`);
  if (fast.length) {
    console.log(`avg confidence(fast): ${mean(fast.map((r) => r.confidence)).toFixed(3)}`);
  }
  if (slow.length) {
    console.log(`avg confidence(slow): ${mean(slow.map((r) => r.confidence)).toFixed(3)}`);
  }

  const outCsv = path.join(projectRoot, "tests", "videos", "features", "evaluation.csv");
  const header = [
    "segment_index",
    "filename",
    "label",
    "notes",
    "points",
    "detection_ratio",
    "matched",
    "confidence",
    "similarity"
  ];
  const lines = [header.join(",")];
  for (const r of evalRows) {
    lines.push(
      [
        r.segment_index,
        r.filename,
        r.label,
        `"${(r.notes || "").replace(/"/g, '""')}"`,
        (r.smoothed_points || []).length,
        r.detection_ratio.toFixed(4),
        r.matched,
        r.confidence.toFixed(4),
        r.similarity.toFixed(4)
      ].join(",")
    );
  }
  fs.writeFileSync(outCsv, lines.join("\n"), "utf8");
  console.log(`saved: ${outCsv}`);
}

main();

