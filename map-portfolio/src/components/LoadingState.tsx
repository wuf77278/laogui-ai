import { AlertTriangle, LoaderCircle } from "lucide-react";

export function LoadingState({ error }: { error?: string }) {
  return (
    <div className={`loading-state ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>
      {error ? <AlertTriangle size={22} /> : <LoaderCircle className="spin" size={22} />}
      <div>
        <strong>{error ? "项目数据没有加载成功" : "正在展开中国山河"}</strong>
        <span>{error || "正在准备地形、影像与设计坐标…"}</span>
      </div>
    </div>
  );
}
