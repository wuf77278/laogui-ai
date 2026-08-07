import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "shared", "mobile-api-config.mjs");
const target = path.join(root, "mobile", "api-config-parser.js");

copyFileSync(source, target);
console.log(`手机版共用解析器已同步：${target}`);

const mobileAssets = path.join(root, "mobile", "assets");
mkdirSync(mobileAssets, { recursive: true });
copyFileSync(
  path.join(root, "public", "assets", "laogui-design-logo-transparent.png"),
  path.join(mobileAssets, "laogui-design-logo-transparent.png")
);
console.log("电脑端老鬼设计标志已同步到手机版");
