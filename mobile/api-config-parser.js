const FIELD_ALIASES = {
  label: ["name", "label", "title", "名称", "配置名称"],
  priority: ["priority", "rank", "order", "调用优先级", "优先级", "顺序"],
  baseUrl: ["baseurl", "base_url", "api_base_url", "openai_base_url", "image_base_url", "url", "endpoint", "接口地址", "地址"],
  apiKey: ["apikey", "api_key", "openai_api_key", "image_api_key", "key", "token", "secret", "密钥"],
  model: ["model", "modelname", "image_model", "模型"],
  textModel: ["textmodel", "text_model", "chat_model", "responses_model", "文字模型", "对话模型"],
  responsesPath: ["responsespath", "responses_path", "chat_path", "文字接口路径", "对话路径"],
  generationPath: ["generationpath", "imagegenerationpath", "image_generation_path", "image_generations_path", "generation_path", "生图路径"],
  editPath: ["editpath", "imageeditpath", "image_edit_path", "image_edits_path", "edit_path", "编辑路径"],
  imagesNewApiCompat: ["imagesnewapicompat", "images_new_api_compat", "兼容模式"]
};

function clean(value = "") {
  return String(value ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

function normalizedKey(value = "") {
  return clean(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function first(record, aliases) {
  const entries = Object.entries(record || {});
  for (const alias of aliases) {
    const match = entries.find(([key]) => normalizedKey(key) === alias);
    if (match && clean(match[1])) return match[1];
  }
  return "";
}

function candidate(record = {}, fallbackLabel = "") {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const nested = record.image && typeof record.image === "object" && !Array.isArray(record.image)
    ? { ...record, ...record.image }
    : record;
  const baseUrl = clean(first(nested, FIELD_ALIASES.baseUrl)).replace(/\/+$/, "");
  const apiKey = clean(first(nested, FIELD_ALIASES.apiKey));
  if (!baseUrl && !apiKey) return null;
  return {
    id: clean(nested.id),
    label: clean(first(nested, FIELD_ALIASES.label)) || fallbackLabel || "未命名接口",
    priority: Number.parseInt(clean(first(nested, FIELD_ALIASES.priority)), 10) || 0,
    baseUrl,
    apiKey,
    model: clean(first(nested, FIELD_ALIASES.model)),
    textModel: clean(first(nested, FIELD_ALIASES.textModel)),
    responsesPath: clean(first(nested, FIELD_ALIASES.responsesPath)) || "/v1/responses",
    generationPath: clean(first(nested, FIELD_ALIASES.generationPath)) || "/v1/images/generations",
    editPath: clean(first(nested, FIELD_ALIASES.editPath)) || "/v1/images/edits",
    imagesNewApiCompat: [true, "true", "1", "yes", "是"].includes(first(nested, FIELD_ALIASES.imagesNewApiCompat)),
    enabled: nested.enabled !== false && nested.active !== false
  };
}

function collectRecords(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const records = [];
  for (const value of [parsed.imageEndpoints, parsed.endpoints, parsed.apiConfigs, parsed.configs, parsed.customProviders, parsed.providers, parsed.settings?.imageEndpoints, parsed.profiles]) {
    if (Array.isArray(value)) records.push(...value.map((item) => item?.image || item));
  }
  if (parsed.image && typeof parsed.image === "object") records.push(parsed.image);
  if (parsed.provider && typeof parsed.provider === "object") records.push(parsed.provider);
  if (candidate(parsed)) records.push(parsed);
  return records;
}

function parseTextBlock(text, fallbackLabel) {
  const values = {};
  const loose = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const match = line.match(/^(?:export\s+)?([^:=]{1,64})\s*[:=]\s*(.+)$/i);
    if (!match) {
      loose.push(clean(line));
      continue;
    }
    const key = normalizedKey(match[1]);
    const target = Object.entries(FIELD_ALIASES).find(([, aliases]) => aliases.includes(key))?.[0];
    if (target) values[target] = clean(match[2]);
  }
  if (!values.baseUrl) values.baseUrl = loose.find((line) => /^https?:\/\//i.test(line)) || "";
  if (!values.apiKey) values.apiKey = loose.find((line) => !/^https?:\/\//i.test(line) && line.length >= 12 && !/\s/.test(line)) || "";
  return candidate(values, fallbackLabel);
}

export function normalizeApiProfiles(profiles = []) {
  const unique = new Map();
  profiles.forEach((profile, index) => {
    const item = candidate(profile, `接口 ${index + 1}`);
    if (!item?.baseUrl || !item.apiKey) return;
    const key = item.baseUrl.toLowerCase();
    const previous = unique.get(key);
    unique.set(key, { ...previous, ...item, id: item.id || previous?.id || crypto.randomUUID(), importIndex: previous?.importIndex ?? index });
  });
  return [...unique.values()]
    .sort((a, b) => (a.priority || Number.MAX_SAFE_INTEGER) - (b.priority || Number.MAX_SAFE_INTEGER) || a.importIndex - b.importIndex)
    .map((item, index) => ({ ...item, priority: index + 1 }));
}

export function parseApiConfigText(text = "", name = "粘贴配置") {
  const source = clean(text).replace(/^\uFEFF/, "");
  if (!source) return { profiles: [], errors: ["配置内容为空"] };
  let records = [];
  try {
    records = collectRecords(JSON.parse(source)).map((item, index) => candidate(item, `${name} ${index + 1}`));
  } catch {
    records = source.split(/\r?\n\s*\r?\n+/).map((block, index) => parseTextBlock(block, `${name} ${index + 1}`));
  }
  const errors = [];
  records.filter(Boolean).forEach((item, index) => {
    if (!item.baseUrl) errors.push(`第 ${index + 1} 组缺少接口地址`);
    if (!item.apiKey) errors.push(`第 ${index + 1} 组缺少 API Key`);
  });
  return { profiles: normalizeApiProfiles(records), errors };
}
