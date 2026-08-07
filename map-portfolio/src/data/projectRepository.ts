import type { Project, ProjectInput } from "./types";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.details?.join("；") || payload.error || "请求失败，请稍后重试");
  }
  return payload.data;
}

export const projectRepository = {
  list(includeHidden = false) {
    return request<Project[]>(`/api/projects${includeHidden ? "?includeHidden=1" : ""}`);
  },
  get(id: string) {
    return request<Project>(`/api/projects/${encodeURIComponent(id)}`);
  },
  create(input: ProjectInput) {
    return request<Project>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
  },
  update(id: string, input: ProjectInput) {
    return request<Project>(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
  },
  remove(id: string) {
    return request<{ id: string }>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async upload(file: File): Promise<string> {
    const body = new FormData();
    body.append("image", file);
    const result = await request<{ url: string }>("/api/uploads", { method: "POST", body });
    return result.url;
  }
};
