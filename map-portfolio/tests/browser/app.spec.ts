import { expect, test } from "@playwright/test";

test("地图首页可以筛选项目并打开详情", async ({ page }) => {
  await page.goto("/map-portfolio/");
  await expect(page.getByRole("heading", { name: "设计行迹" })).toBeVisible();
  await expect(page.locator("#cesiumContainer canvas")).toBeVisible({ timeout: 20000 });
  await page.getByLabel("关键词搜索").fill("潮汐");
  await expect(page.getByText("共 1 个项目")).toBeVisible();
  await page.getByRole("button", { name: /潮汐客厅/ }).click();
  await expect(page.getByRole("heading", { name: "潮汐客厅" })).toBeVisible();
});

test("后台可以打开新增项目表单", async ({ page }) => {
  await page.goto("/map-portfolio/admin/");
  await expect(page.getByRole("heading", { name: "项目管理" })).toBeVisible();
  await page.getByRole("button", { name: "新增项目" }).click();
  await expect(page.getByLabel("项目名称")).toBeVisible();
});
