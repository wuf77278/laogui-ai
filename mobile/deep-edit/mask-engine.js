const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createMask(width, height, fill = 0) {
  const mask = new Uint8Array(Math.max(1, width * height));
  if (fill) mask.fill(255);
  return mask;
}

export function cloneMask(mask) {
  return new Uint8Array(mask || 0);
}

export function maskHasSelection(mask) {
  return Boolean(mask?.some((value) => value > 0));
}

export function combineMasks(base, incoming, mode = "replace") {
  const length = Math.min(base.length, incoming.length);
  const out = mode === "replace" ? new Uint8Array(base.length) : new Uint8Array(base);
  for (let index = 0; index < length; index += 1) {
    const a = base[index];
    const b = incoming[index];
    if (mode === "add") out[index] = Math.max(a, b);
    else if (mode === "subtract") out[index] = Math.max(0, a - b);
    else if (mode === "intersect") out[index] = Math.min(a, b);
    else out[index] = b;
  }
  return out;
}

export function invertMask(mask) {
  const out = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) out[index] = 255 - mask[index];
  return out;
}

export function maskBounds(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let area = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    area += 1;
  }
  if (!area) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area };
}

export function rectangleMask(width, height, from, to) {
  const out = createMask(width, height);
  const left = clamp(Math.floor(Math.min(from.x, to.x)), 0, width - 1);
  const top = clamp(Math.floor(Math.min(from.y, to.y)), 0, height - 1);
  const right = clamp(Math.ceil(Math.max(from.x, to.x)), left, width - 1);
  const bottom = clamp(Math.ceil(Math.max(from.y, to.y)), top, height - 1);
  for (let y = top; y <= bottom; y += 1) {
    out.fill(255, y * width + left, y * width + right + 1);
  }
  return out;
}

export function ellipseMask(width, height, from, to) {
  const out = createMask(width, height);
  const left = clamp(Math.floor(Math.min(from.x, to.x)), 0, width - 1);
  const top = clamp(Math.floor(Math.min(from.y, to.y)), 0, height - 1);
  const right = clamp(Math.ceil(Math.max(from.x, to.x)), left, width - 1);
  const bottom = clamp(Math.ceil(Math.max(from.y, to.y)), top, height - 1);
  const rx = Math.max(0.5, (right - left + 1) / 2);
  const ry = Math.max(0.5, (bottom - top + 1) / 2);
  const cx = left + rx - 0.5;
  const cy = top + ry - 0.5;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) out[y * width + x] = 255;
    }
  }
  return out;
}

export function polygonMask(width, height, points = []) {
  const out = createMask(width, height);
  if (points.length < 3) return out;
  const normalized = points.map((point) => ({
    x: clamp(Number(point.x) || 0, 0, width - 1),
    y: clamp(Number(point.y) || 0, 0, height - 1)
  }));
  const minY = clamp(Math.floor(Math.min(...normalized.map((point) => point.y))), 0, height - 1);
  const maxY = clamp(Math.ceil(Math.max(...normalized.map((point) => point.y))), minY, height - 1);
  for (let y = minY; y <= maxY; y += 1) {
    const scanY = y + 0.5;
    const intersections = [];
    for (let index = 0; index < normalized.length; index += 1) {
      const a = normalized[index];
      const b = normalized[(index + 1) % normalized.length];
      if ((a.y > scanY) === (b.y > scanY)) continue;
      intersections.push(a.x + ((scanY - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = clamp(Math.ceil(intersections[index]), 0, width - 1);
      const right = clamp(Math.floor(intersections[index + 1]), left, width - 1);
      out.fill(255, y * width + left, y * width + right + 1);
    }
  }
  return out;
}

function paintDisk(mask, width, height, cx, cy, radius, value = 255) {
  const left = clamp(Math.floor(cx - radius), 0, width - 1);
  const top = clamp(Math.floor(cy - radius), 0, height - 1);
  const right = clamp(Math.ceil(cx + radius), left, width - 1);
  const bottom = clamp(Math.ceil(cy + radius), top, height - 1);
  const radiusSq = radius * radius;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radiusSq) mask[y * width + x] = value;
    }
  }
}

export function strokeMask(width, height, points = [], radius = 12) {
  const out = createMask(width, height);
  if (!points.length) return out;
  const safeRadius = clamp(Number(radius) || 1, 1, Math.max(width, height));
  paintDisk(out, width, height, points[0].x, points[0].y, safeRadius);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, safeRadius * 0.35)));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      paintDisk(out, width, height, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, safeRadius);
    }
  }
  return out;
}

function colorDistance(data, a, b) {
  const ai = a * 4;
  const bi = b * 4;
  const dr = data[ai] - data[bi];
  const dg = data[ai + 1] - data[bi + 1];
  const db = data[ai + 2] - data[bi + 2];
  return Math.sqrt(dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11);
}

function lumaAt(data, index) {
  const offset = index * 4;
  return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
}

export function magicWandMask(data, width, height, startX, startY, tolerance = 30) {
  const out = createMask(width, height);
  if (!data?.length || data.length < width * height * 4) return out;
  const x = clamp(Math.floor(startX), 0, width - 1);
  const y = clamp(Math.floor(startY), 0, height - 1);
  const seed = y * width + x;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const threshold = 7 + clamp(Number(tolerance) || 0, 0, 100) * 1.45;
  let head = 0;
  let tail = 0;
  queue[tail++] = seed;
  visited[seed] = 1;
  out[seed] = 255;
  while (head < tail) {
    const current = queue[head++];
    const cx = current % width;
    const cy = Math.floor(current / width);
    const neighbors = [
      cx > 0 ? current - 1 : -1,
      cx < width - 1 ? current + 1 : -1,
      cy > 0 ? current - width : -1,
      cy < height - 1 ? current + width : -1
    ];
    for (const next of neighbors) {
      if (next < 0 || visited[next]) continue;
      visited[next] = 1;
      const seedDistance = colorDistance(data, seed, next);
      const localDistance = colorDistance(data, current, next);
      const edgeJump = Math.abs(lumaAt(data, current) - lumaAt(data, next));
      if (seedDistance > threshold || (localDistance > threshold * 0.72 && edgeJump > threshold * 0.42)) continue;
      out[next] = 255;
      queue[tail++] = next;
    }
  }
  return out;
}

export function colorRangeMask(data, width, height, startX, startY, tolerance = 30) {
  const out = createMask(width, height);
  if (!data?.length || data.length < width * height * 4) return out;
  const x = clamp(Math.floor(startX), 0, width - 1);
  const y = clamp(Math.floor(startY), 0, height - 1);
  const seed = y * width + x;
  const threshold = 7 + clamp(Number(tolerance) || 0, 0, 100) * 1.45;
  for (let index = 0; index < width * height; index += 1) {
    if (colorDistance(data, seed, index) <= threshold) out[index] = 255;
  }
  return out;
}

function morphology(mask, width, height, radius, grow) {
  let current = new Uint8Array(mask);
  const steps = clamp(Math.round(Math.abs(radius)), 0, 64);
  for (let step = 0; step < steps; step += 1) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let value = grow ? 0 : 255;
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            const nx = x + kx;
            const ny = y + ky;
            const sample = nx < 0 || nx >= width || ny < 0 || ny >= height ? 0 : current[ny * width + nx];
            value = grow ? Math.max(value, sample) : Math.min(value, sample);
          }
        }
        next[y * width + x] = value;
      }
    }
    current = next;
  }
  return current;
}

export function growMask(mask, width, height, pixels = 1) {
  return morphology(mask, width, height, pixels, true);
}

export function shrinkMask(mask, width, height, pixels = 1) {
  return morphology(mask, width, height, pixels, false);
}

export function featherMask(mask, width, height, pixels = 1) {
  let current = new Uint8Array(mask);
  const steps = clamp(Math.round(Math.abs(pixels)), 0, 32);
  for (let step = 0; step < steps; step += 1) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            const nx = x + kx;
            const ny = y + ky;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            sum += current[ny * width + nx];
            count += 1;
          }
        }
        next[y * width + x] = Math.round(sum / Math.max(1, count));
      }
    }
    current = next;
  }
  return current;
}
