import { describe, expect, it } from "vitest";
import { filterProjects, validateProjectInput } from "../../src/data/projectLogic";
import type { Project } from "../../src/data/types";

const projects: Project[] = [
  {
    id: "p-1", title: "山地庭院", slug: "mountain-courtyard", province: "四川", city: "西昌",
    longitude: 102.27, latitude: 27.9, year: 2021, category: "文化旅居", area: "8420 m²",
    summary: "顺应山势的庭院。", description: "让建筑与山谷相连。", coverImage: "/cover.jpg",
    gallery: [], importance: 3, isFeatured: true, isPublished: true,
    createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z"
  },
  {
    id: "p-2", title: "潮汐客厅", slug: "tide-lounge", province: "浙江", city: "宁波",
    longitude: 121.55, latitude: 29.87, year: 2024, category: "精品酒店", area: "12600 m²",
    summary: "面向海岸的公共客厅。", description: "以潮汐组织空间。", coverImage: "/cover.jpg",
    gallery: [], importance: 2, isFeatured: false, isPublished: true,
    createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z"
  }
];

describe("项目筛选", () => {
  it("可以按关键词、省份、类型和年份组合筛选", () => {
    const result = filterProjects(projects, {
      keyword: "庭院", province: "四川", city: "全部", category: "文化旅居", year: 2021,
      featuredOnly: false
    });
    expect(result.map((project) => project.id)).toEqual(["p-1"]);
  });

  it("只向访客显示已公开项目", () => {
    const hidden = { ...projects[0], id: "hidden", isPublished: false };
    expect(filterProjects([...projects, hidden], {
      keyword: "", province: "全部", city: "全部", category: "全部", year: "全部", featuredOnly: false
    })).toHaveLength(2);
  });
});

describe("项目数据校验", () => {
  it("拒绝越界经纬度和空标题", () => {
    const result = validateProjectInput({ ...projects[0], title: "", latitude: 120 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("项目名称不能为空");
    expect(result.errors).toContain("纬度必须在 -90 到 90 之间");
  });

  it("接受完整的项目资料", () => {
    expect(validateProjectInput(projects[0])).toEqual({ valid: true, errors: [] });
  });
});
