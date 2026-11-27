/**
 * 生成应用图标（无第三方依赖，纯手写 PNG）
 * 512 超采样后降到 256，保证边缘平滑
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const OUT = 256;
const SS = 2; // 超采样倍数
const S = OUT * SS;

const buf = new Uint8ClampedArray(S * S * 4); // RGBA

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 圆角矩形命中测试（支持四角独立半径） */
function inRoundRect(px, py, x, y, w, h, [tl, tr, br, bl]) {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const test = (cx, cy, r) => {
    if (r <= 0) return true;
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= r * r;
  };
  if (px < x + tl && py < y + tl) return test(x + tl, y + tl, tl);
  if (px > x + w - tr && py < y + tr) return test(x + w - tr, y + tr, tr);
  if (px > x + w - br && py > y + h - br) return test(x + w - br, y + h - br, br);
  if (px < x + bl && py > y + h - bl) return test(x + bl, y + h - bl, bl);
  return true;
}

function fillRoundRect(x, y, w, h, radii, color, alpha = 255) {
  const r = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
  const [r0, g0, b0] = color;
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      if (px < 0 || py < 0 || px >= S || py >= S) continue;
      if (!inRoundRect(px + 0.5, py + 0.5, x, y, w, h, r)) continue;
      const i = (py * S + px) * 4;
      const a = alpha / 255;
      buf[i] = buf[i] * (1 - a) + r0 * a;
      buf[i + 1] = buf[i + 1] * (1 - a) + g0 * a;
      buf[i + 2] = buf[i + 2] * (1 - a) + b0 * a;
      buf[i + 3] = Math.max(buf[i + 3], alpha);
    }
  }
}

/** 垂直渐变圆角矩形 */
function fillGradientRect(x, y, w, h, radii, from, to) {
  const r = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    const t = Math.min(1, Math.max(0, (py - y) / h));
    const col = [
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
    ];
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      if (px < 0 || py < 0 || px >= S || py >= S) continue;
      if (!inRoundRect(px + 0.5, py + 0.5, x, y, w, h, r)) continue;
      const i = (py * S + px) * 4;
      buf[i] = col[0];
      buf[i + 1] = col[1];
      buf[i + 2] = col[2];
      buf[i + 3] = 255;
    }
  }
}

const k = S / 512; // 以 512 为设计基准缩放

// 1. 底板：蓝色渐变圆角方块
fillGradientRect(10 * k, 10 * k, 492 * k, 492 * k, 118 * k, [111, 177, 252], [43, 108, 226]);

// 2. 挂环
fillRoundRect(150 * k, 44 * k, 30 * k, 92 * k, 15 * k, [235, 242, 255]);
fillRoundRect(332 * k, 44 * k, 30 * k, 92 * k, 15 * k, [235, 242, 255]);

// 3. 白色页面
fillRoundRect(84 * k, 92 * k, 344 * k, 336 * k, 46 * k, [255, 255, 255]);

// 4. 顶部色带（上圆角，下直角）
fillRoundRect(84 * k, 92 * k, 344 * k, 78 * k, [46 * k, 46 * k, 0, 0], [37, 99, 235]);

// 5. 日期点阵 3 行 x 4 列
const dot = 34 * k;
const gapX = 62 * k;
const gapY = 58 * k;
const startX = 120 * k;
const startY = 206 * k;
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 4; col++) {
    const isToday = row === 0 && col === 2;
    const color = isToday ? [245, 158, 11] : row === 2 ? [226, 233, 244] : [203, 213, 225];
    fillRoundRect(startX + col * gapX, startY + row * gapY, dot, dot, 10 * k, color);
  }
}

// 降采样
const out = Buffer.alloc(OUT * OUT * 4);
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * S + (x * SS + dx)) * 4;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; a += buf[i + 3];
      }
    }
    const n = SS * SS;
    const o = (y * OUT + x) * 4;
    out[o] = Math.round(r / n);
    out[o + 1] = Math.round(g / n);
    out[o + 2] = Math.round(b / n);
    out[o + 3] = Math.round(a / n);
  }
}

// 组装 PNG
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT, 0);
ihdr.writeUInt32BE(OUT, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc((OUT * 4 + 1) * OUT);
for (let y = 0; y < OUT; y++) {
  raw[y * (OUT * 4 + 1)] = 0;
  out.copy(raw, y * (OUT * 4 + 1) + 1, y * OUT * 4, (y + 1) * OUT * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(new URL('../public/icon.png', import.meta.url), png);
console.log('icon.png written:', png.length, 'bytes');
