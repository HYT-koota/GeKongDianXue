const fs = require("fs");
const path = require("path");
const { loadShared } = require("./lib/load_shared");

const projectRoot = path.resolve(__dirname, "..");
const { CONFIG, TrajectoryNormalizer, GestureAverager, SpeedDetector } = loadShared(projectRoot);

function readItems(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return (payload.items || []).filter((x) => x.label === "1");
}

function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) {
    console.error("Usage: node tests/build_standard_from_samples.js <features.json...>");
    process.exit(1);
  }

  const items = inputs.flatMap((p) =>
    readItems(path.isAbsolute(p) ? p : path.join(projectRoot, p))
  );
  const trajectories = items
    .map((x) => x.smoothed_points || x.normalizedTrajectory || [])
    .filter((t) => t.length >= 10);

  if (!trajectories.length) {
    console.error("No usable positive trajectories found.");
    process.exit(1);
  }

  const normalizedTrajs = trajectories.map((t) => TrajectoryNormalizer.normalize(t));
  const avgNormalizedTrajectory = GestureAverager.averageNormalizedTrajectories(normalizedTrajs, 50);

  const speedProfiles = trajectories.map((t) => SpeedDetector.analyze(t, CONFIG));
  const avgSpeedProfile = GestureAverager.averageSpeedProfiles(speedProfiles);

  const standardGesture = {
    normalizedTrajectory: avgNormalizedTrajectory.map((p) => ({
      x: Number(p.x.toFixed(4)),
      y: Number(p.y.toFixed(4)),
      timestamp: Math.round(p.timestamp)
    })),
    speedProfile: {
      peakSpeed: Number(avgSpeedProfile.peakSpeed.toFixed(4)),
      avgSpeed: Number(avgSpeedProfile.avgSpeed.toFixed(4))
    },
    recordingCount: trajectories.length
  };

  const outPath = path.join(projectRoot, "standard_gesture.json");
  fs.writeFileSync(outPath, JSON.stringify(standardGesture, null, 2), "utf8");
  console.log("Built standard gesture from samples.");
  console.log(`samples: ${trajectories.length}`);
  console.log(`peakSpeed: ${standardGesture.speedProfile.peakSpeed}`);
  console.log(`avgSpeed: ${standardGesture.speedProfile.avgSpeed}`);
  console.log(`saved: ${outPath}`);
}

main();

