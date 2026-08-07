import { ImagePlus, Save, X } from "lucide-react";
import { useState } from "react";
import { validateProjectInput } from "../data/projectLogic";
import { projectRepository } from "../data/projectRepository";
import type { Project, ProjectInput, ProjectImportance } from "../data/types";

const blankProject: ProjectInput = {
  title: "", slug: "", province: "", city: "", longitude: 104.06, latitude: 30.67,
  year: new Date().getFullYear(), category: "文化旅居", area: "", summary: "", description: "",
  coverImage: "/map-portfolio/assets/project-cover.png", gallery: [], importance: 1,
  isFeatured: false, isPublished: true
};

export function ProjectForm({ project, onCancel, onSave }: { project: Project | null; onCancel: () => void; onSave: (input: ProjectInput) => Promise<void> }) {
  const [form, setForm] = useState<ProjectInput>(project ?? blankProject);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = validateProjectInput(form);
    setErrors(result.errors);
    if (!result.valid) return;
    setBusy(true);
    try { await onSave(form); }
    finally { setBusy(false); }
  };

  const uploadCover = async (file: File) => {
    setBusy(true);
    setErrors([]);
    try { update("coverImage", await projectRepository.upload(file)); }
    catch (error) { setErrors([(error as Error).message]); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="project-form-dialog" role="dialog" aria-modal="true" aria-labelledby="project-form-title">
        <header><div><span>项目资料</span><h2 id="project-form-title">{project ? "编辑项目" : "新增项目"}</h2></div><button onClick={onCancel} title="关闭" aria-label="关闭"><X size={18} /></button></header>
        <form onSubmit={submit}>
          {errors.length > 0 && <div className="form-errors" role="alert">{errors.map((error) => <span key={error}>{error}</span>)}</div>}
          <div className="form-layout">
            <div className="cover-upload">
              <img src={form.coverImage} alt="项目封面预览" />
              <label className="secondary-button"><ImagePlus size={15} />上传封面<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={(event) => event.target.files?.[0] && void uploadCover(event.target.files[0])} /></label>
              <small>支持 JPG、PNG、WebP、AVIF，最大 8MB</small>
            </div>
            <div className="form-fields">
              <label className="wide"><span>项目名称</span><input aria-label="项目名称" value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="例如：山地庭院" /></label>
              <label><span>省份</span><input value={form.province} onChange={(event) => update("province", event.target.value)} placeholder="四川" /></label>
              <label><span>城市</span><input value={form.city} onChange={(event) => update("city", event.target.value)} placeholder="西昌" /></label>
              <label><span>经度</span><input type="number" step="0.000001" value={form.longitude} onChange={(event) => update("longitude", Number(event.target.value))} /></label>
              <label><span>纬度</span><input type="number" step="0.000001" value={form.latitude} onChange={(event) => update("latitude", Number(event.target.value))} /></label>
              <label><span>年份</span><input type="number" min="1900" max="2100" value={form.year} onChange={(event) => update("year", Number(event.target.value))} /></label>
              <label><span>项目类型</span><input value={form.category} onChange={(event) => update("category", event.target.value)} placeholder="文化旅居" /></label>
              <label><span>项目面积</span><input value={form.area} onChange={(event) => update("area", event.target.value)} placeholder="8,420 m²" /></label>
              <label><span>重要程度</span><select value={form.importance} onChange={(event) => update("importance", Number(event.target.value) as ProjectImportance)}><option value="1">普通项目</option><option value="2">重点项目</option><option value="3">代表项目</option></select></label>
              <label className="wide"><span>简短介绍</span><textarea rows={2} value={form.summary} onChange={(event) => update("summary", event.target.value)} placeholder="一句话说明项目的核心特点" /></label>
              <label className="wide"><span>详细说明</span><textarea rows={4} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="设计思路、材料、空间关系等" /></label>
              <div className="form-switches wide"><label><input type="checkbox" checked={form.isFeatured} onChange={(event) => update("isFeatured", event.target.checked)} />设为代表作</label><label><input type="checkbox" checked={form.isPublished} onChange={(event) => update("isPublished", event.target.checked)} />在地图公开</label></div>
            </div>
          </div>
          <footer><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button className="primary-button" disabled={busy}><Save size={15} />{busy ? "正在保存…" : "保存项目"}</button></footer>
        </form>
      </section>
    </div>
  );
}
