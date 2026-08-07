const startsWith = (buffer, bytes) => bytes.every((byte, index) => buffer[index] === byte);

export function hasValidImageSignature(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (mimeType === "image/png") {
    return buffer.length >= 8 && startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && startsWith(buffer, [0xff, 0xd8, 0xff]);
  }
  if (mimeType === "image/webp") {
    return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  }
  if (mimeType === "image/avif") {
    if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") return false;
    const brands = buffer.toString("ascii", 8, Math.min(buffer.length, 32));
    return brands.includes("avif") || brands.includes("avis");
  }
  return false;
}
