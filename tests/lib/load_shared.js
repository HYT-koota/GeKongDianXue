const fs = require("fs");
const vm = require("vm");
const path = require("path");

function loadShared(projectRoot) {
  const sharedPath = path.join(projectRoot, "shared.js");
  const code = fs.readFileSync(sharedPath, "utf8");
  const sandbox = { console, Math, Date, JSON };
  vm.createContext(sandbox);
  vm.runInContext(
    `${code}
this.__exports__ = {
  CONFIG,
  TrajectoryNormalizer,
  SpeedDetector,
  GestureAverager,
  GestureMatcher
};`,
    sandbox
  );
  return sandbox.__exports__;
}

function loadEmbeddedStandardGesture(projectRoot) {
  const appPath = path.join(projectRoot, "app.js");
  const code = fs.readFileSync(appPath, "utf8");
  const startToken = "const STANDARD_GESTURE =";
  const start = code.indexOf(startToken);
  if (start < 0) {
    throw new Error("STANDARD_GESTURE not found in app.js");
  }
  const braceStart = code.indexOf("{", start);
  if (braceStart < 0) {
    throw new Error("STANDARD_GESTURE object start not found");
  }
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    throw new Error("STANDARD_GESTURE object end not found");
  }
  const objectLiteral = code.slice(braceStart, end + 1);
  return vm.runInNewContext(`(${objectLiteral})`, {});
}

module.exports = {
  loadShared,
  loadEmbeddedStandardGesture
};

