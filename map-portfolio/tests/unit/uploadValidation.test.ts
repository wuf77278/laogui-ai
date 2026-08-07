import { describe, expect, it } from "vitest";
import { hasValidImageSignature } from "../../server/uploadValidation.mjs";

describe("图片内容校验", () => {
  it("接受与声明类型一致的 PNG 文件头", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(hasValidImageSignature(png, "image/png")).toBe(true);
  });

  it("拒绝伪装成图片的文本", () => {
    expect(hasValidImageSignature(Buffer.from("not an image"), "image/png")).toBe(false);
  });
});
