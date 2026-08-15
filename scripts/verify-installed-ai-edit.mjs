import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const appBaseUrl = String(process.env.LAOGUI_TEST_APP_URL || "http://127.0.0.1:4177").replace(/\/+$/, "");
const mockPort = Number(process.env.LAOGUI_TEST_MOCK_PORT || 4388);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function rgbaPng(red, green, blue, alpha) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = deflateSync(Buffer.from([0, red, green, blue, alpha]));
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", pixels),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${appBaseUrl}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${pathname} returned HTTP ${response.status}`);
  return body;
}

const outputPng = rgbaPng(76, 140, 96, 255);
const sourceDataUrl = `data:image/png;base64,${rgbaPng(210, 190, 160, 255).toString("base64")}`;
const maskDataUrl = `data:image/png;base64,${rgbaPng(255, 255, 255, 0).toString("base64")}`;
const mockServer = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ b64_json: outputPng.toString("base64") }] }));
  });
});

await new Promise((resolve, reject) => {
  mockServer.once("error", reject);
  mockServer.listen(mockPort, "127.0.0.1", resolve);
});

let testEndpointId = "";
let previousActiveEndpointId = "";
try {
  const currentSettings = await requestJson("/api/settings");
  previousActiveEndpointId = String(
    currentSettings.settings?.imageEndpoints?.find((endpoint) => endpoint.enabled === true)?.id || ""
  );
  const added = await requestJson("/api/settings/image-endpoints", {
    method: "POST",
    body: JSON.stringify({
      label: "Windows 安装包验收接口",
      baseUrl: `http://127.0.0.1:${mockPort}`,
      apiKey: "local-test-key",
      model: "gpt-image-2",
      apiMode: "images",
      imageGenerationPath: "/v1/images/generations",
      imageEditPath: "/v1/images/edits",
      enabled: true,
      priority: 1
    })
  });
  testEndpointId = String(added.endpoint?.id || "");
  if (!testEndpointId) throw new Error("没有取得临时验收接口编号");
  const result = await requestJson("/api/ai-edit?clientId=windows-installer-test", {
    method: "POST",
    body: JSON.stringify({
      operation: "replace",
      selectionMode: "precise",
      prompt: "把选区改成浅灰色，保持其他内容不变",
      promptOptimizationEnabled: false,
      image: { name: "source.png", type: "image/png", dataUrl: sourceDataUrl },
      mask: { dataUrl: maskDataUrl, width: 1, height: 1, bounds: { x: 0, y: 0, width: 1, height: 1, area: 1 } },
      outputSize: "1024x1024",
      quality: "low",
      suppressTaskLog: true
    })
  });
  if (!result.render?.url?.startsWith("/generated/")) throw new Error("AI 编辑没有返回生成图片");
  if (result.render?.imageApi !== "image-studio-cli") throw new Error(`AI 编辑没有使用内置图片引擎：${result.render?.imageApi || "unknown"}`);
  console.log(JSON.stringify({ ok: true, imageApi: result.render.imageApi, url: result.render.url }));
} finally {
  if (testEndpointId) {
    await requestJson(`/api/settings/image-endpoints/${encodeURIComponent(testEndpointId)}`, { method: "DELETE" }).catch(() => {});
  }
  if (previousActiveEndpointId) {
    await requestJson(`/api/settings/image-endpoints/${encodeURIComponent(previousActiveEndpointId)}/activate`, { method: "POST" }).catch(() => {});
  }
  await new Promise((resolve) => mockServer.close(resolve));
}
