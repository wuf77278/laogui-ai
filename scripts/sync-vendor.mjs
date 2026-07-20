import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.dirname(path.dirname(__filename));
const vendorDir = path.join(rootDir, "public", "vendor");
const checkOnly = process.argv.includes("--check");

const files = [
  {
    source: path.join(rootDir, "node_modules", "three", "build", "three.module.js"),
    target: path.join(vendorDir, "three.module.js")
  },
  {
    source: path.join(rootDir, "node_modules", "three", "examples", "jsm", "exporters", "GLTFExporter.js"),
    target: path.join(vendorDir, "GLTFExporter.js"),
    transform: (source) => source
      .replace("} from 'three';", "} from './three.module.js';")
      .replace("import { decompress } from './../utils/TextureUtils.js';", "import { decompress } from './TextureUtils.js';")
  },
  {
    source: path.join(rootDir, "node_modules", "three", "examples", "jsm", "utils", "TextureUtils.js"),
    target: path.join(vendorDir, "TextureUtils.js"),
    transform: (source) => source.replace("} from 'three';", "} from './three.module.js';")
  },
  {
    source: path.join(rootDir, "node_modules", "pannellum", "build", "pannellum.js"),
    target: path.join(vendorDir, "pannellum.js")
  },
  {
    source: path.join(rootDir, "node_modules", "pannellum", "build", "pannellum.css"),
    target: path.join(vendorDir, "pannellum.css")
  }
];

async function readVendorFile(file) {
  const raw = await fs.readFile(file.source, file.binary ? undefined : "utf8");
  return file.transform ? file.transform(raw) : raw;
}

async function main() {
  await fs.mkdir(vendorDir, { recursive: true });
  const mismatches = [];

  for (const file of files) {
    const expected = await readVendorFile(file);
    await fs.mkdir(path.dirname(file.target), { recursive: true });
    if (checkOnly) {
      const current = await fs.readFile(file.target, file.binary ? undefined : "utf8").catch(() => file.binary ? Buffer.alloc(0) : "");
      const matches = file.binary ? Buffer.compare(current, expected) === 0 : current === expected;
      if (!matches) mismatches.push(path.relative(rootDir, file.target));
      continue;
    }
    await fs.writeFile(file.target, expected);
  }

  if (mismatches.length) {
    console.error(`[vendor] out of sync: ${mismatches.join(", ")}`);
    console.error("[vendor] run npm run vendor:sync");
    process.exit(1);
  }

  console.log(checkOnly ? "[vendor] ok" : "[vendor] synced");
}

main().catch((error) => {
  console.error(`[vendor] ${error.message || error}`);
  process.exit(1);
});
