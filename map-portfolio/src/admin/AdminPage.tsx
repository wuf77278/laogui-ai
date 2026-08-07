import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, DatabaseBackup, FileUp, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { projectRepository } from "../data/projectRepository";
import type { Project, ProjectInput } from "../data/types";
import { ProjectForm } from "./ProjectForm";

export function AdminPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [editing, setEditing] = useState<Project | null | "new">(null);
  const [keyword, setKeyword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setBusy(true);
    try { setProjects(await projectRepository.list(true)); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const visibleProjects = useMemo(() => {
    const search = keyword.trim().toLocaleLowerCase("zh-CN");
    if (!search) return projects;
    return projects.filter((project) => [project.title, project.province, project.city, project.category].join(" ").toLocaleLowerCase("zh-CN").includes(search));
  }, [projects, keyword]);

  const save = async (input: ProjectInput) => {
    setMessage("");
    try {
      if (editing === "new") await projectRepository.create(input);
      else if (editing) await projectRepository.update(editing.id, input);
      await load();
      setEditing(null);
      setMessage("项目已经保存，地图页面刷新后即可看到。 ");
    } catch (error) { setMessage((error as Error).message); }
  };

  const remove = async (project: Project) => {
    if (!window.confirm(`确定删除“${project.title}”吗？删除后不能直接恢复。`)) return;
    try {
      await projectRepository.remove(project.id);
      await load();
      setMessage("项目已经删除。 ");
    } catch (error) { setMessage((error as Error).message); }
  };

  const restore = async (file: File) => {
    if (!window.confirm("恢复备份会替换当前全部项目数据，是否继续？")) return;
    const body = new FormData();
    body.append("backup", file);
    try {
      const response = await fetch("/api/restore", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "恢复失败");
      await load();
      setMessage("备份已经恢复。 ");
    } catch (error) { setMessage((error as Error).message); }
  };

  return (
    <main className="admin-app">
      <header className="admin-header">
        <div>
          <a href="/map-portfolio/" className="back-link"><ArrowLeft size={15} />返回地图</a>
          <h1>项目管理</h1>
          <p>在这里维护项目资料，不需要修改代码。</p>
        </div>
        <div className="admin-actions">
          <a className="secondary-button" href="/api/backup" download><DatabaseBackup size={15} />备份数据</a>
          <button className="secondary-button" onClick={() => restoreInputRef.current?.click()}><FileUp size={15} />恢复备份</button>
          <input ref={restoreInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => event.target.files?.[0] && void restore(event.target.files[0])} />
          <button className="primary-button" onClick={() => setEditing("new")}><Plus size={16} />新增项目</button>
        </div>
      </header>

      {message && <div className="admin-message" role="status">{message}</div>}

      <section className="admin-content">
        <div className="admin-list-head">
          <div><strong>项目资料</strong><span>{projects.length} 条记录</span></div>
          <label className="admin-search"><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" /></label>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>项目</th><th>地点</th><th>年份</th><th>类型</th><th>状态</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {visibleProjects.map((project) => (
                <tr key={project.id}>
                  <td><div className="admin-project"><img src={project.coverImage} alt="" /><div><strong>{project.title}</strong><small>{project.isFeatured ? "代表作" : `等级 ${project.importance}`}</small></div></div></td>
                  <td><span className="table-location"><MapPin size={13} />{project.province} · {project.city}</span></td>
                  <td>{project.year}</td><td>{project.category}</td>
                  <td><span className={`status-badge ${project.isPublished ? "published" : "hidden"}`}>{project.isPublished ? "已公开" : "已隐藏"}</span></td>
                  <td><div className="table-actions"><button onClick={() => setEditing(project)} title={`编辑${project.title}`} aria-label={`编辑${project.title}`}><Pencil size={15} /></button><button className="danger" onClick={() => void remove(project)} title={`删除${project.title}`} aria-label={`删除${project.title}`}><Trash2 size={15} /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!busy && !visibleProjects.length && <div className="admin-empty">没有找到项目</div>}
          {busy && <div className="admin-empty">正在读取项目数据…</div>}
        </div>
      </section>

      {editing && <ProjectForm project={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSave={save} />}
    </main>
  );
}
