const SECRET_PATTERNS = [
  [/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1已隐藏"],
  [/(--api-key\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1已隐藏"],
  [/(\b(?:api[_-]?key|token|secret)\b\s*[=:]\s*)["']?[^\s,"'}]+/gi, "$1已隐藏"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "已隐藏"]
];

export function redactDiagnosticText(value = "") {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value));
}

function diagnosticText(value, maxLength = 6000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
  const redacted = redactDiagnosticText(text || "").trim();
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}\n...内容已截断` : redacted;
}

export function recentFailureLogs(logs = [], { days = 30, now = Date.now() } = {}) {
  const cutoff = now - Math.max(1, Number(days) || 30) * 86400000;
  return logs.filter((log) => {
    if (!['failed', 'canceled'].includes(log?.status)) return false;
    const timestamp = Date.parse(log.completedAt || log.startedAt || "");
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now + 60000;
  });
}

export function recentDiagnosticEntries(entries = [], { days = 7, now = Date.now() } = {}) {
  const cutoff = now - Math.max(1, Number(days) || 7) * 86400000;
  return entries.filter((entry) => {
    const timestamp = Date.parse(entry?.time || entry?.completedAt || entry?.startedAt || "");
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now + 60000;
  });
}

export function sanitizeDiagnosticValue(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^data:image\//i.test(value)) return "[图片内容已省略]";
    return redactDiagnosticText(value);
  }
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticValue);
  if (typeof value !== "object") return value;
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:imageData|dataUrl)$/i.test(key)) {
      safe[key] = "[图片内容已省略]";
    } else if (/^(?:api[_-]?key|token|secret|authorization|cookie)$/i.test(key)) {
      safe[key] = "已隐藏";
    } else {
      safe[key] = sanitizeDiagnosticValue(item);
    }
  }
  return safe;
}

export function buildDiagnosticSummary({ events = [], tasks = [], system = {}, days = 7, now = Date.now() } = {}) {
  const recentEvents = recentDiagnosticEntries(events, { days, now });
  const recentTasks = recentDiagnosticEntries(tasks, { days, now });
  const failures = recentTasks.filter((item) => ["failed", "canceled"].includes(item?.status));
  const lines = [
    "# 老鬼AI 问题诊断摘要",
    "",
    markdownField("导出时间", new Date(now).toISOString()),
    markdownField("软件版本", system.version || "未知"),
    markdownField("系统", system.platform || "未知"),
    markdownField("日志范围", `最近 ${days} 天`),
    markdownField("操作记录", recentEvents.length),
    markdownField("任务记录", recentTasks.length),
    markdownField("失败或取消", failures.length),
    "",
    "> API 密钥、令牌和图片内容已经自动隐藏。提示词和图片文件名会保留用于排查。",
    "",
    "## 最近异常",
    ""
  ].filter((line) => line !== "");
  const errors = [...recentEvents.filter((item) => item?.level === "error" || item?.status === "failed"), ...failures].slice(-30).reverse();
  if (!errors.length) lines.push("最近没有记录到异常。", "");
  else errors.forEach((item) => lines.push(`- ${diagnosticText(item.time || item.completedAt || item.startedAt, 80)} · ${diagnosticText(item.action || item.type || "异常", 120)} · ${diagnosticText(item.message || item.error?.message || item.status, 500)}`));
  return `${lines.join("\n")}\n`;
}

export function diagnosticJsonLines(entries = [], options = {}) {
  const recent = recentDiagnosticEntries(entries, options);
  return recent.map((entry) => JSON.stringify(sanitizeDiagnosticValue(entry))).join("\n") + (recent.length ? "\n" : "");
}

function markdownField(label, value) {
  const text = diagnosticText(value, 12000);
  return text ? `- ${label}：${text.replace(/\n/g, "\n  ")}` : "";
}

export function buildFailureLogMarkdown(logs = [], options = {}) {
  const days = Math.max(1, Number(options.days) || 30);
  const failures = recentFailureLogs(logs, { days, now: options.now });
  const lines = [
    "# 老鬼AI 失败日志",
    "",
    markdownField("导出时间", new Date(options.now || Date.now()).toISOString()),
    markdownField("软件版本", options.version || "未知"),
    markdownField("系统", options.platform || "未知"),
    markdownField("日志范围", `最近 ${days} 天`),
    markdownField("记录数量", failures.length),
    "",
    "> 安全说明：API 密钥、令牌和认证信息已经自动隐藏；文件不包含图片内容。",
    ""
  ].filter((line) => line !== "");

  if (!failures.length) {
    lines.push("最近没有失败或取消记录。", "");
    return `${lines.join("\n")}\n`;
  }

  failures.forEach((log, index) => {
    const attempts = Array.isArray(log.result?.attempts) && log.result.attempts.length
      ? log.result.attempts
      : Array.isArray(log.error?.attempts) ? log.error.attempts : [];
    const section = [
      `## ${index + 1}. ${log.status === "canceled" ? "已取消" : "生成失败"} · ${diagnosticText(log.type || "未知任务", 200)}`,
      "",
      markdownField("任务编号", log.id),
      markdownField("时间", log.completedAt || log.startedAt),
      markdownField("耗时", log.durationMs != null ? `${log.durationMs} ms` : ""),
      markdownField("批次", log.input?.batchId),
      markdownField("批次进度", log.input?.batchIndex && log.input?.batchCount ? `${log.input.batchIndex}/${log.input.batchCount}` : ""),
      markdownField("模式", log.input?.mode || log.input?.stepMode),
      markdownField("参考图数量", log.input?.referenceCount),
      markdownField("接口", log.result?.endpoint || log.error?.endpoint || log.activeImageBaseUrl),
      markdownField("错误状态", log.error?.status),
      markdownField("错误信息", log.error?.message || (log.status === "canceled" ? "用户停止生成" : "")),
      markdownField("用户指令", log.input?.userPrompt || log.input?.intent),
      markdownField("诊断详情", log.error?.details),
      attempts.length ? "- 接口尝试：" : "",
      ...attempts.map((attempt) => `  - ${diagnosticText(`${attempt.status || ""} · ${attempt.name || ""} · ${attempt.endpoint || ""}${attempt.error ? ` · ${attempt.error}` : ""}`, 1600)}`),
      ""
    ].filter((line) => line !== "");
    lines.push(...section);
  });
  return `${lines.join("\n")}\n`;
}
