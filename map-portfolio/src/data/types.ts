export type ProjectImportance = 1 | 2 | 3;

export interface Project {
  id: string;
  title: string;
  slug: string;
  province: string;
  city: string;
  longitude: number;
  latitude: number;
  year: number;
  category: string;
  area: string;
  summary: string;
  description: string;
  coverImage: string;
  gallery: string[];
  importance: ProjectImportance;
  isFeatured: boolean;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFilters {
  keyword: string;
  province: string;
  city: string;
  category: string;
  year: number | "全部";
  featuredOnly: boolean;
}

export type ProjectInput = Omit<Project, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
