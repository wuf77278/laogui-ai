import type { Project, ProjectFilters, ProjectInput, ValidationResult } from "./types";

export const ALL_OPTION = "全部";

export function filterProjects(projects: Project[], filters: ProjectFilters): Project[] {
  const keyword = filters.keyword.trim().toLocaleLowerCase("zh-CN");

  return projects.filter((project) => {
    if (!project.isPublished) return false;
    if (filters.province !== ALL_OPTION && project.province !== filters.province) return false;
    if (filters.city !== ALL_OPTION && project.city !== filters.city) return false;
    if (filters.category !== ALL_OPTION && project.category !== filters.category) return false;
    if (filters.year !== ALL_OPTION && project.year !== filters.year) return false;
    if (filters.featuredOnly && !project.isFeatured) return false;

    if (!keyword) return true;
    const searchable = [project.title, project.province, project.city, project.category, project.summary]
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    return searchable.includes(keyword);
  });
}

export function validateProjectInput(input: Partial<ProjectInput>): ValidationResult {
  const errors: string[] = [];
  if (!String(input.title ?? "").trim()) errors.push("项目名称不能为空");
  if (!String(input.province ?? "").trim()) errors.push("省份不能为空");
  if (!String(input.city ?? "").trim()) errors.push("城市不能为空");
  if (!String(input.category ?? "").trim()) errors.push("项目类型不能为空");

  const longitude = Number(input.longitude);
  const latitude = Number(input.latitude);
  const year = Number(input.year);
  const importance = Number(input.importance);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) errors.push("经度必须在 -180 到 180 之间");
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) errors.push("纬度必须在 -90 到 90 之间");
  if (!Number.isInteger(year) || year < 1900 || year > 2100) errors.push("年份必须在 1900 到 2100 之间");
  if (![1, 2, 3].includes(importance)) errors.push("重要程度只能是 1、2 或 3");

  return { valid: errors.length === 0, errors };
}

export function uniqueSortedValues(projects: Project[], key: "province" | "city" | "category"): string[] {
  return [...new Set(projects.map((project) => project[key]).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export function projectYears(projects: Project[]): number[] {
  return [...new Set(projects.map((project) => project.year))].sort((left, right) => left - right);
}
