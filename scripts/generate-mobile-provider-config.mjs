import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
export const aggregateSkillPath = "/Users/Apple_501/.codex/skills/aggregate-image-generation/SKILL.md";
export const aggregateScriptPath = "/Users/Apple_501/.codex/skills/aggregate-image-generation/scripts/yingfang_image.py";
export const outputPath = path.join(root, "mobile", "provider-config.json");

function readAggregateConstants() {
  const code = [
    "import importlib.util, json, sys",
    "path = sys.argv[1]",
    "spec = importlib.util.spec_from_file_location('laogui_aggregate_image', path)",
    "module = importlib.util.module_from_spec(spec)",
    "sys.modules[spec.name] = module",
    "spec.loader.exec_module(module)",
    "print(json.dumps({",
    "  'order': list(module.AUTO_PROVIDER_ORDER),",
    "  'model': module.DEFAULT_IMAGE_MODEL,",
    "  'apiMode': module.DEFAULT_API_MODE,",
    "  'requestPolicy': module.DEFAULT_REQUEST_POLICY,",
    "  'providers': {",
    "    'fhl': {'baseUrl': module.DEFAULT_BASE_URL, 'compat': module.DEFAULT_IMAGES_NEW_API_COMPAT},",
    "    'yybb': {'baseUrl': module.YYBB_BASE_URL, 'compat': module.YYBB_IMAGES_NEW_API_COMPAT},",
    "    'aiwanwu': {'baseUrl': module.AIWANWU_BASE_URL, 'compat': module.DEFAULT_IMAGES_NEW_API_COMPAT}",
    "  }",
    "}, ensure_ascii=False))"
  ].join("\n");
  const result = spawnSync("python3", ["-c", code, aggregateScriptPath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`无法读取聚合生图脚本：${result.stderr || "未知错误"}`);
  return JSON.parse(result.stdout);
}

function readEndpoints(skillText) {
  const match = skillText.match(/Text-to-image uses `([^`]+)`; one or more reference images use `([^`]+)`/);
  if (!match) throw new Error("聚合生图说明中没有找到 Images API 路径");
  return { generation: match[1], edit: match[2] };
}

export function generateMobileProviderConfig(target = outputPath) {
  const scriptText = readFileSync(aggregateScriptPath, "utf8");
  const skillText = readFileSync(aggregateSkillPath, "utf8");
  const constants = readAggregateConstants();
  const endpoints = readEndpoints(skillText);
  const providers = constants.order.map((name) => {
    const provider = constants.providers[name];
    if (!provider) throw new Error(`聚合生图脚本缺少 ${name} 配置`);
    return { id: name, baseUrl: provider.baseUrl, imagesNewApiCompat: Boolean(provider.compat) };
  });
  const config = {
    source: "aggregate-image-generation",
    sourceHash: createHash("sha256").update(scriptText).update(skillText).digest("hex").slice(0, 16),
    apiMode: constants.apiMode,
    requestPolicy: constants.requestPolicy,
    model: constants.model,
    endpoints,
    providers
  };
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generateMobileProviderConfig();
  console.log(`手机版接口配置已更新：${outputPath}`);
}
