import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import "./sync-mobile-shared.mjs";

const root = path.resolve(import.meta.dirname, "..");
const javaCandidates = [
  process.env.JAVA_HOME,
  "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
  "/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
].filter(Boolean);
const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  "/opt/homebrew/share/android-commandlinetools",
  path.join(process.env.HOME || "", "Library", "Android", "sdk")
].filter(Boolean);
const javaHome = javaCandidates.find(existsSync);
const androidHome = sdkCandidates.find(existsSync);
if (!javaHome) throw new Error("没有找到 Java 21，请先安装 openjdk@21");
if (!androidHome) throw new Error("没有找到 Android SDK，请先安装安卓命令行工具");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome, PATH: `${path.join(javaHome, "bin")}:${process.env.PATH || ""}` }
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

run(path.join(root, "node_modules", ".bin", "cap"), ["sync", "android"], root);
run(path.join(root, "android", "gradlew"), ["assembleDebug"], path.join(root, "android"));
console.log(`安卓安装包：${path.join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk")}`);
