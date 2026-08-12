import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("电脑端更新和发布地址固定使用 Gitee", async () => {
  const main = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const expectedUrl = "https://gitee.com/wuf7727/laogui-ai/raw/main/update/";

  assert.match(main, /autoUpdater\.setFeedURL/);
  assert.match(main, new RegExp(expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(packageJson.build.publish[0].provider, "generic");
  assert.equal(packageJson.build.publish[0].url, expectedUrl);
});
