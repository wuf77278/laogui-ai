self.onmessage = (event) => {
  const { id, pixels, mask, width, height, adjustments = {} } = event.data || {};
  try {
    const source = new Uint8ClampedArray(pixels);
    const selection = mask ? new Uint8Array(mask) : null;
    const output = new Uint8ClampedArray(source);
    const exposure = Math.pow(2, Number(adjustments.exposure || 0) / 100);
    const contrast = 1 + Number(adjustments.contrast || 0) * 0.009;
    const saturation = 1 + Number(adjustments.saturation || 0) * 0.01;
    const vibrance = Number(adjustments.vibrance || 0) * 0.01;
    const temperature = Number(adjustments.temperature || 0) * 0.55;
    const tint = Number(adjustments.tint || 0) * 0.42;
    const hue = Number(adjustments.hue || 0) * Math.PI / 100;
    const highlights = Number(adjustments.highlights || 0) * 0.8;
    const shadows = Number(adjustments.shadows || 0) * 0.8;
    const whites = Number(adjustments.whites || 0) * 0.7;
    const blacks = Number(adjustments.blacks || 0) * 0.7;
    const dehaze = Number(adjustments.dehaze || 0) * 0.006;
    const curvePoints = [
      0,
      64 + Number(adjustments.curveShadows || 0) * 0.55,
      128 + Number(adjustments.curveMidtones || 0) * 0.55,
      192 + Number(adjustments.curveHighlights || 0) * 0.55,
      255
    ].map((value) => Math.max(0, Math.min(255, value)));
    const curveValue = (value) => {
      const section = Math.min(3, Math.max(0, Math.floor(value / 64)));
      const fromX = section * 64;
      const toX = section === 3 ? 255 : (section + 1) * 64;
      const amount = (value - fromX) / Math.max(1, toX - fromX);
      return curvePoints[section] + (curvePoints[section + 1] - curvePoints[section]) * amount;
    };
    for (let index = 0; index < width * height; index += 1) {
      const blend = selection ? selection[index] / 255 : 1;
      if (blend <= 0) continue;
      const offset = index * 4;
      let r = source[offset] * exposure;
      let g = source[offset + 1] * exposure;
      let b = source[offset + 2] * exposure;
      let luma = r * 0.299 + g * 0.587 + b * 0.114;
      const highlightWeight = Math.max(0, Math.min(1, (luma - 110) / 145));
      const shadowWeight = 1 - Math.max(0, Math.min(1, luma / 150));
      const tone = highlights * highlightWeight + shadows * shadowWeight + whites * highlightWeight * highlightWeight + blacks * shadowWeight * shadowWeight;
      const localContrast = contrast + dehaze;
      r = (r + tone - 128) * localContrast + 128 + temperature + tint * 0.35;
      g = (g + tone - 128) * localContrast + 128 - tint;
      b = (b + tone - 128) * localContrast + 128 - temperature + tint * 0.35;
      luma = r * 0.299 + g * 0.587 + b * 0.114;
      const colorRange = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      const saturationFactor = saturation + vibrance * (1 - Math.max(0, Math.min(1, colorRange)));
      r = luma + (r - luma) * saturationFactor;
      g = luma + (g - luma) * saturationFactor;
      b = luma + (b - luma) * saturationFactor;
      if (Math.abs(hue) > 0.0001) {
        const cos = Math.cos(hue);
        const sin = Math.sin(hue);
        const nr = (.213 + cos * .787 - sin * .213) * r + (.715 - cos * .715 - sin * .715) * g + (.072 - cos * .072 + sin * .928) * b;
        const ng = (.213 - cos * .213 + sin * .143) * r + (.715 + cos * .285 + sin * .140) * g + (.072 - cos * .072 - sin * .283) * b;
        const nb = (.213 - cos * .213 - sin * .787) * r + (.715 - cos * .715 + sin * .715) * g + (.072 + cos * .928 + sin * .072) * b;
        r = nr; g = ng; b = nb;
      }
      r = curveValue(Math.max(0, Math.min(255, r)));
      g = curveValue(Math.max(0, Math.min(255, g)));
      b = curveValue(Math.max(0, Math.min(255, b)));
      output[offset] = source[offset] + (Math.max(0, Math.min(255, r)) - source[offset]) * blend;
      output[offset + 1] = source[offset + 1] + (Math.max(0, Math.min(255, g)) - source[offset + 1]) * blend;
      output[offset + 2] = source[offset + 2] + (Math.max(0, Math.min(255, b)) - source[offset + 2]) * blend;
    }
    const vignette = Number(adjustments.vignette || 0) / 100;
    const grain = Math.max(0, Number(adjustments.grain || 0)) / 100;
    if (Math.abs(vignette) > 0.001 || grain > 0.001) {
      const cx = (width - 1) / 2;
      const cy = (height - 1) / 2;
      const maxDistance = Math.max(1, Math.hypot(cx, cy));
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          const blend = selection ? selection[index] / 255 : 1;
          if (blend <= 0) continue;
          const edge = Math.max(0, (Math.hypot(x - cx, y - cy) / maxDistance - .28) / .72);
          const factor = 1 - vignette * edge * edge * .72;
          const noise = grain ? ((((index * 1664525 + 1013904223) >>> 16) & 255) / 255 - .5) * grain * 34 : 0;
          for (let channel = 0; channel < 3; channel += 1) {
            const offset = index * 4 + channel;
            const changed = output[offset] * factor + noise;
            output[offset] = source[offset] + (Math.max(0, Math.min(255, changed)) - source[offset]) * blend;
          }
        }
      }
    }
    const denoise = Math.max(0, Math.min(1, Number(adjustments.denoise || 0) / 100));
    if (denoise > 0.01) {
      const base = new Uint8ClampedArray(output);
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          const blend = (selection ? selection[index] / 255 : 1) * denoise * 0.85;
          if (blend <= 0) continue;
          for (let channel = 0; channel < 3; channel += 1) {
            let total = 0;
            for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) total += base[((y + oy) * width + x + ox) * 4 + channel];
            const current = base[index * 4 + channel];
            output[index * 4 + channel] = current + (total / 9 - current) * blend;
          }
        }
      }
    }
    const clarity = Math.max(0, Math.min(1, Number(adjustments.clarity || 0) / 100));
    const sharpen = Math.max(0, Math.min(1, Number(adjustments.sharpen || 0) / 100));
    const detailStrength = clarity * 0.75 + sharpen * 1.25;
    if (detailStrength > 0.01) {
      const base = new Uint8ClampedArray(output);
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          const blend = (selection ? selection[index] / 255 : 1) * detailStrength;
          if (blend <= 0) continue;
          for (let channel = 0; channel < 3; channel += 1) {
            const center = base[index * 4 + channel];
            const blur = (
              base[(index - 1) * 4 + channel] + base[(index + 1) * 4 + channel] +
              base[(index - width) * 4 + channel] + base[(index + width) * 4 + channel]
            ) / 4;
            output[index * 4 + channel] = Math.max(0, Math.min(255, center + (center - blur) * blend));
          }
        }
      }
    }
    self.postMessage({ id, ok: true, pixels: output.buffer }, [output.buffer]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
