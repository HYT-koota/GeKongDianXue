const fs = require("fs");
const path = require("path");
const { loadShared, loadEmbeddedStandardGesture } = require("./lib/load_shared");

const projectRoot = path.resolve(__dirname, "..");
const { CONFIG, GestureMatcher } = loadShared(projectRoot);
let standard = loadEmbeddedStandardGesture(projectRoot);
const learnedPath = path.join(projectRoot, "standard_gesture.json");
if (fs.existsSync(learnedPath)) {
  try {
    standard = JSON.parse(fs.readFileSync(learnedPath, "utf8"));
  } catch (_) {
    // keep embedded fallback
  }
}

function evaluateFile(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const matcher = new GestureMatcher({ ...CONFIG, debugSpeedCheck: false });
  const items = payload.items || [];
  const rows = items.map((it) => {
    const r = matcher.evaluate(it.smoothed_points || [], standard);
    return {
      segment_index: it.segment_index,
      points: it.point_count,
      duration_ms: it.duration_ms,
      matched: r.isMatched ? 1 : 0,
      confidence: r.confidence,
      similarity: r.details?.similarityScore ?? 0
    };
  });
  const matchedCount = rows.filter((r) => r.matched === 1).length;
  return {
    video: payload.video,
    segment_count: rows.length,
    matched_count: matchedCount,
    hit_rate: rows.length ? matchedCount / rows.length : 0,
    rows
  };
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Usage: node tests/eval_continuous_actions.js <json1> [json2...]");
    process.exit(1);
  }

  console.log("=== Continuous Action Evaluation ===");
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(projectRoot, f);
    const r = evaluateFile(abs);
    console.log(`\nvideo: ${r.video}`);
    console.log(`segments: ${r.segment_count}, matched: ${r.matched_count}, hit_rate: ${(r.hit_rate * 100).toFixed(1)}%`);
    for (const row of r.rows) {
      console.log(
        `  #${row.segment_index} points=${row.points} duration_ms=${row.duration_ms} matched=${row.matched} conf=${row.confidence.toFixed(3)} sim=${row.similarity.toFixed(3)}`
      );
    }
  }
}

main();
