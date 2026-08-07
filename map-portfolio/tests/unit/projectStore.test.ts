import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectStore } from "../../server/projectStore.mjs";

let directory = "";
let filePath = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "design-map-"));
  filePath = join(directory, "projects.json");
  await writeFile(filePath, "[]", "utf8");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("本地项目仓库", () => {
  it("可以新增、修改和删除项目，并写入 JSON 文件", async () => {
    const store = createProjectStore(filePath);
    const created = await store.create({
      title: "测试庭院", slug: "test-yard", province: "四川", city: "成都",
      longitude: 104.06, latitude: 30.67, year: 2026, category: "文化空间", area: "1000 m²",
      summary: "测试简介", description: "测试说明", coverImage: "/cover.jpg", gallery: [],
      importance: 2, isFeatured: false, isPublished: true
    });
    expect(created.id).toBeTruthy();

    const updated = await store.update(created.id, { ...created, title: "修改后的庭院" });
    expect(updated?.title).toBe("修改后的庭院");
    expect(await store.remove(created.id)).toBe(true);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual([]);
  });

  it("拒绝不完整的项目资料", async () => {
    const store = createProjectStore(filePath);
    await expect(store.create({ title: "", longitude: 999 })).rejects.toThrow("项目名称不能为空");
  });
});
