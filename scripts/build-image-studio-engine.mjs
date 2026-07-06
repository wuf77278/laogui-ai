import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.dirname(path.dirname(__filename));
const sourceDir = path.join(rootDir, "engines", "image-studio", "source", "go-cli");
const currentPlatformId = `${process.platform}-${process.arch}`;
const engineDir = path.join(rootDir, "engines", "image-studio");
const allReleaseTargets = ["darwin-arm64", "darwin-x64", "win32-x64", "win32-arm64"];
const goPlatformMap = {
  darwin: "darwin",
  win32: "windows",
  linux: "linux"
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    stdio: "inherit",
    env: { ...process.env, ...(options.env || {}) }
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function executableName(platform) {
  return platform === "win32" ? "gptcodex-image.exe" : "gptcodex-image";
}

function normalizeTarget(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  const [platform, arch] = normalized.split("-");
  if (!platform || !arch || !goPlatformMap[platform]) {
    throw new Error(`Unsupported target "${value}". Use values like darwin-arm64 or win32-x64.`);
  }
  if (!["arm64", "x64"].includes(arch)) {
    throw new Error(`Unsupported target arch "${arch}" in "${value}".`);
  }
  return `${platform}-${arch}`;
}

function parseTargets(argv) {
  const targets = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") return allReleaseTargets;
    if (arg === "--target" || arg === "--platform") {
      const value = argv[index + 1] || "";
      index += 1;
      targets.push(...value.split(",").map(normalizeTarget).filter(Boolean));
      continue;
    }
    if (arg.startsWith("--target=")) {
      targets.push(...arg.slice("--target=".length).split(",").map(normalizeTarget).filter(Boolean));
      continue;
    }
    if (arg.startsWith("--platform=")) {
      targets.push(...arg.slice("--platform=".length).split(",").map(normalizeTarget).filter(Boolean));
      continue;
    }
    targets.push(...arg.split(",").map(normalizeTarget).filter(Boolean));
  }
  return [...new Set(targets.length ? targets : [currentPlatformId])];
}

function goEnvForTarget(target) {
  const [platform, arch] = target.split("-");
  return {
    GOOS: goPlatformMap[platform],
    GOARCH: arch === "x64" ? "amd64" : arch,
    CGO_ENABLED: "0"
  };
}

async function buildTarget(target) {
  const [platform] = target.split("-");
  const outputPath = path.join(engineDir, target, executableName(platform));
  await mkdir(path.dirname(outputPath), { recursive: true });
  run("go", ["build", "-o", outputPath, "./cmd/gptcodex-image"], {
    cwd: sourceDir,
    env: goEnvForTarget(target)
  });
  if (platform !== "win32") await chmod(outputPath, 0o755);
  console.log(`[image-studio-engine] built ${path.relative(rootDir, outputPath)}`);
  return outputPath;
}

async function main() {
  if (!existsSync(path.join(sourceDir, "go.mod"))) {
    throw new Error(`Missing Image Studio go-cli source: ${sourceDir}`);
  }

  const targets = parseTargets(process.argv.slice(2));
  run("go", ["mod", "download"], { cwd: sourceDir });
  run("go", ["test", "./..."], { cwd: sourceDir });

  for (const target of targets) {
    const outputPath = await buildTarget(target);
    if (target === currentPlatformId) {
      const legacyOutputPath = path.join(engineDir, executableName(process.platform));
      await copyFile(outputPath, legacyOutputPath);
      if (process.platform !== "win32") await chmod(legacyOutputPath, 0o755);
      console.log(`[image-studio-engine] updated legacy path ${path.relative(rootDir, legacyOutputPath)}`);
    }
  }
}

main().catch((error) => {
  console.error(`[image-studio-engine] ${error.message || error}`);
  process.exit(1);
});
