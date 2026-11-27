/**
 * 应用图标生成器
 *
 * 图案就是 Gately 官方图标（web/public/favicon.svg 与 docs/images/logo.svg 同一份）：
 *   32×32 圆角矩形，渐变 #18a888 → #0b5f4f，白色「G」形圆弧 + 横杠，右上角 #9ff3dc 圆点。
 *
 * 这里只做两件事，不改设计：
 *   1. 按 512 网格重绘（官方坐标 ×16），3× 超采样降采样，小尺寸边缘不发虚；
 *   2. 留出标准应用图标安全边距（16/512），贴边圆角在小卡片里更容易被裁切。
 *
 * 用法：node build/make-icon.mjs [输出名]
 * 纯手写 PNG，无第三方依赖。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const OUT = 256;
const SS = 3;
const S = OUT * SS;
const k = S / 512;

const buf = new Float32Array(S * S * 4);

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
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

function paint(px, py, rgb, a = 1) {
  if (px < 0 || py < 0 || px >= S || py >= S || a <= 0) return;
  const i = (py * S + px) * 4;
  const dst = buf[i + 3];
  const outA = a + dst * (1 - a);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) buf[i + c] = (rgb[c] * a + buf[i + c] * dst * (1 - a)) / outA;
  buf[i + 3] = outA;
}

function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const test = (cx, cy) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  if (px < x + r && py < y + r) return test(x + r, y + r);
  if (px > x + w - r && py < y + r) return test(x + w - r, y + r);
  if (px > x + w - r && py > y + h - r) return test(x + w - r, y + h - r);
  if (px < x + r && py > y + h - r) return test(x + r, y + h - r);
  return true;
}

/** 官方底色：线性渐变 from → to，左上角一点柔和反光 */
function tile(x, y, w, h, radius, from, to, glow = 0.1) {
  const gx = x + w * 0.22;
  const gy = y + h * 0.14;
  const gr = w * 0.7;
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      if (!inRoundRect(cx, cy, x, y, w, h, radius)) continue;
      const t = Math.min(1, Math.max(0, ((cx - x) / w) * 0.55 + ((cy - y) / h) * 0.45));
      paint(px, py, [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ]);
      const d = Math.hypot(cx - gx, cy - gy) / gr;
      if (d < 1 && glow > 0) paint(px, py, [255, 255, 255], (1 - d) ** 2 * glow);
    }
  }
}

function fillCircle(cx, cy, r, rgb, a = 1) {
  for (let py = Math.floor(cy - r); py <= Math.ceil(cy + r); py++) {
    for (let px = Math.floor(cx - r); px <= Math.ceil(cx + r); px++) {
      if ((px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 <= r * r) paint(px, py, rgb, a);
    }
  }
}

/** 圆环扇形：a0 → a1（弧度，0 在右侧，顺时针增长） */
function fillArc(cx, cy, r0, r1, a0, a1, rgb, a = 1) {
  for (let py = Math.floor(cy - r1); py <= Math.ceil(cy + r1); py++) {
    for (let px = Math.floor(cx - r1); px <= Math.ceil(cx + r1); px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d < r0 || d > r1) continue;
      let ang = Math.atan2(dy, dx);
      if (ang < 0) ang += Math.PI * 2;
      if (ang >= a0 && ang <= a1) paint(px, py, rgb, a);
    }
  }
}

/** 圆头线段 */
function strokeLine(x0, y0, x1, y1, r, rgb, a = 1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r * 0.4)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, rgb, a);
  }
}

const WHITE = [255, 255, 255];

// ---------- 绘制 ----------
// 官方坐标（32 单位）统一 ×16 换到 512 网格
const P = (v) => v * 16 * k;

// 底色：#18a888 → #0b5f4f，圆角 9/32，四周留 16/512 的安全边距
tile(16 * k, 16 * k, 480 * k, 480 * k, 136 * k, [24, 168, 136], [11, 95, 79]);

// 「G」形圆弧：圆心 (16,16) r=8，描边 3，缺口在右上（315°→360°），两端圆头
const CX = P(16);
const CY = P(16);
const R = P(8);
const STROKE = 24 * k; // 描边 3 → 半径 1.5
fillArc(CX, CY, R - STROKE, R + STROKE, 0, (315 * Math.PI) / 180, WHITE);
fillCircle(P(21.7), P(10.3), STROKE, WHITE); // 圆弧起点圆头
fillCircle(P(24), P(16), STROKE, WHITE); // 圆弧终点圆头

// 圆弧收尾的横杠：M24 16 h-7
strokeLine(P(24), P(16), P(17), P(16), STROKE, WHITE);

// 右上角亮点：#9ff3dc
fillCircle(P(23.6), P(8.6), P(2.2), [159, 243, 220]);

// ---------- 降采样输出 ----------
const out = Buffer.alloc(OUT * OUT * 4);
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * S + (x * SS + dx)) * 4;
        const al = buf[i + 3];
        r += buf[i] * al;
        g += buf[i + 1] * al;
        b += buf[i + 2] * al;
        a += al;
      }
    }
    const n = SS * SS;
    const o = (y * OUT + x) * 4;
    if (a > 0) {
      out[o] = Math.min(255, Math.round(r / a));
      out[o + 1] = Math.min(255, Math.round(g / a));
      out[o + 2] = Math.min(255, Math.round(b / a));
    }
    out[o + 3] = Math.round((a / n) * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT, 0);
ihdr.writeUInt32BE(OUT, 4);
ihdr[8] = 8;
ihdr[9] = 6;

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

const outName = process.argv[2] || 'icon.png';
writeFileSync(new URL(`../public/${outName}`, import.meta.url), png);
console.log(`${outName} written:`, png.length, 'bytes');
