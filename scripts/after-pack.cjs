const fs = require("node:fs/promises");
const path = require("node:path");

const ARCH_NAMES = {
  0: "ia32",
  1: "x64",
  2: "armv7l",
  3: "arm64",
  4: "universal"
};

module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH_NAMES[context.arch] || process.arch;
  const resourcesDir = platform === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");

  const engineRoot = path.join(resourcesDir, "engines", "image-studio");
  const keepEngine = `${platform}-${arch}`;
  for (const candidate of ["darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64"]) {
    if (candidate !== keepEngine) await fs.rm(path.join(engineRoot, candidate), { recursive: true, force: true });
  }
};
