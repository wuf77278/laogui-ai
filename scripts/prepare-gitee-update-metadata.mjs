import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

const releaseDir = path.resolve(process.argv[2] || "release");
const updateDir = path.resolve(process.argv[3] || "update");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const version = String(packageJson.version || "").trim();
const releaseBaseUrl = `https://gitee.com/wuf7727/laogui-ai/releases/download/v${version}`;

function assetName(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("更新清单中存在空文件名");
  try {
    return path.posix.basename(new URL(raw).pathname);
  } catch {
    return path.basename(raw);
  }
}

async function prepare(name) {
  const sourcePath = path.join(releaseDir, name);
  const targetPath = path.join(updateDir, name);
  const document = yaml.load(await readFile(sourcePath, "utf8"));
  if (String(document?.version || "") !== version) {
    throw new Error(`${name} 版本不正确：期望 ${version}，实际 ${document?.version || "空"}`);
  }
  if (!Array.isArray(document.files) || document.files.length === 0) {
    throw new Error(`${name} 没有更新文件`);
  }
  document.files = document.files.map((file) => ({
    ...file,
    url: `${releaseBaseUrl}/${assetName(file.url)}`
  }));
  document.path = `${releaseBaseUrl}/${assetName(document.path)}`;
  await writeFile(targetPath, yaml.dump(document, { lineWidth: -1, noRefs: true }), "utf8");
}

await Promise.all([prepare("latest.yml"), prepare("latest-mac.yml")]);
console.log(`已生成 Gitee ${version} 更新清单。`);
