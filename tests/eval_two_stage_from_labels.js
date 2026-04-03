const fs = require("fs");
const path = require("path");
const { loadShared, loadEmbeddedStandardGesture } = require("./lib/load_shared");

const projectRoot = path.resolve(__dirname, "..");
const { CONFIG, GestureMatcher } = loadShared(projectRoot);
const standard = loadEmbeddedStandardGesture(projectRoot);

function keyOf(datasetName, item) {
  return `${datasetName}|${item.filename}|${item.segment_index}`;
}

function loadJson(relPath) {
  const p = path.join(projectRoot, relPath);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function evaluateOne(item, stage, matcher) {
  const trajectory = item.smoothed_points || [];
  const r = matcher.evaluate(trajectory, standard);
  const similarity = r.details?.similarityScore ?? 0;
  const speedMatched = r.details?.speedScore === 1;
  const confidence = r.confidence ?? 0;

  const strictMatch =
    (similarity >= 0.32 && confidence >= 0.26) ||
    (speedMatched && similarity >= 0.28 && confidence >= 0.22);
  const endpointBoostMatch =
    (similarity >= 0.16 && confidence >= 0.12) ||
    (speedMatched && similarity >= 0.12) ||
    confidence >= 0.16;

  const phaseAReady = !!stage?.phase_a_ready;
  const endpointAfterA = !!stage?.endpoint_seen_after_phase_a;
  const baseMatched = endpointAfterA ? endpointBoostMatch : strictMatch;
  const extinguish = phaseAReady && endpointAfterA && baseMatched;

  return {
    extinguish,
    similarity,
    speedMatched,
    confidence,
    phaseAReady,
    endpointAfterA,
    endpointWhile2H: !!stage?.endpoint_seen_while_two_hands,
  };
}

function rate(arr, pred) {
  if (!arr.length) return 0;
  return arr.filter(pred).length / arr.length;
}

function main() {
  const bundles = [
    {
      feature: "tests/videos/features/trajectories.json",
      stage: "tests/videos/features/stage_summary_pos.json",
      datasetName: "labels.csv",
    },
    {
      feature: "tests/videos/features/trajectories_neg_normal.json",
      stage: "tests/videos/features/stage_summary_neg_normal.json",
      datasetName: "labels_neg_normal.csv",
    },
    {
      feature: "tests/videos/features/trajectories_neg_hard.json",
      stage: "tests/videos/features/stage_summary_neg_hard.json",
      datasetName: "labels_neg_hard.csv",
    },
    {
      feature: "tests/videos/features/trajectories_260403.json",
      stage: "tests/videos/features/stage_summary_260403.json",
      datasetName: "labels_260403.csv",
    },
  ];

  const matcher = new GestureMatcher({ ...CONFIG, debugSpeedCheck: false });
  const rows = [];

  for (const b of bundles) {
    const featureData = loadJson(b.feature);
    const stageData = loadJson(b.stage);
    if (!featureData || !stageData) continue;

    const stageMap = new Map();
    for (const s of stageData.items || []) {
      stageMap.set(keyOf(b.datasetName, s), s);
    }

    for (const it of featureData.items || []) {
      if (!it.label) continue;
      const key = keyOf(b.datasetName, it);
      const stage = stageMap.get(key);
      const out = evaluateOne(it, stage, matcher);
      rows.push({
        dataset: b.datasetName,
        filename: it.filename,
        segment_index: it.segment_index,
        label: it.label,
        notes: it.notes || "",
        ...out,
      });
    }
  }

  const pos = rows.filter((r) => r.label === "1");
  const neg = rows.filter((r) => r.label === "0");
  const negNormal = neg.filter((r) => r.dataset === "labels_neg_normal.csv");
  const negHard = neg.filter((r) => r.dataset === "labels_neg_hard.csv");

  const tpr = rate(pos, (r) => r.extinguish);
  const fpr = rate(neg, (r) => r.extinguish);
  const fprNormal = rate(negNormal, (r) => r.extinguish);
  const fprHard = rate(negHard, (r) => r.extinguish);
  const earlyEndpointRateNeg = rate(neg, (r) => r.endpointWhile2H);

  console.log("=== Two-Stage Offline Evaluation ===");
  console.log(`config: combined=${CONFIG.combinedThreshold}, minPeak=${CONFIG.minPeakSpeedRatio}, minAvg=${CONFIG.minAvgSpeedRatio}`);
  console.log(`samples: pos=${pos.length}, neg=${neg.length} (normal=${negNormal.length}, hard=${negHard.length})`);
  console.log(`TPR(extinguish): ${(tpr * 100).toFixed(1)}%`);
  console.log(`FPR(extinguish): ${(fpr * 100).toFixed(1)}%`);
  console.log(`FPR normal: ${(fprNormal * 100).toFixed(1)}%`);
  console.log(`FPR hard: ${(fprHard * 100).toFixed(1)}%`);
  console.log(`Neg endpoint while two-hands (early-trigger risk): ${(earlyEndpointRateNeg * 100).toFixed(1)}%`);

  const badPos = pos.filter((r) => !r.extinguish).slice(0, 8);
  const badNeg = neg.filter((r) => r.extinguish).slice(0, 8);

  if (badPos.length) {
    console.log("\nPositives missed (top 8):");
    for (const r of badPos) {
      console.log(
        `  ${r.dataset}#${r.segment_index} ${r.filename} phaseA=${r.phaseAReady} endpointAfterA=${r.endpointAfterA} conf=${r.confidence.toFixed(3)} sim=${r.similarity.toFixed(3)}`
      );
    }
  }
  if (badNeg.length) {
    console.log("\nNegatives wrongly extinguished (top 8):");
    for (const r of badNeg) {
      console.log(
        `  ${r.dataset}#${r.segment_index} ${r.filename} endpointWhile2H=${r.endpointWhile2H} conf=${r.confidence.toFixed(3)} sim=${r.similarity.toFixed(3)}`
      );
    }
  }
}

main();
