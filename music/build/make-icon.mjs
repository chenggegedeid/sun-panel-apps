/**
 * 图标方案生成器
 *   node build/make-icon.mjs note|vinyl|wave|headphone [输出名]
 * 不带参数时生成 public/icon.png（音符方案）
 *
 * 纯手写 PNG，无第三方依赖：3× 超采样后降采样
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

function tile(x, y, w, h, radius, from, to, glow = 0.22) {
  const gx = x + w * 0.24;
  const gy = y + h * 0.16;
  const gr = w * 0.72;
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

function fillRing(cx, cy, r0, r1, rgb, a = 1) {
  for (let py = Math.floor(cy - r1); py <= Math.ceil(cy + r1); py++) {
    for (let px = Math.floor(cx - r1); px <= Math.ceil(cx + r1); px++) {
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
      if (d >= r0 && d <= r1) paint(px, py, rgb, a);
    }
  }
}

function fillEllipseRot(cx, cy, rx, ry, angle, rgb, a = 1) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const r = Math.max(rx, ry) + 2;
  for (let py = Math.floor(cy - r); py <= Math.ceil(cy + r); py++) {
    for (let px = Math.floor(cx - r); px <= Math.ceil(cx + r); px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      const x2 = dx * cos + dy * sin;
      const y2 = -dx * sin + dy * cos;
      if ((x2 * x2) / (rx * rx) + (y2 * y2) / (ry * ry) <= 1) paint(px, py, rgb, a);
    }
  }
}

function fillRoundRect(x, y, w, h, r, rgb, a = 1) {
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      if (inRoundRect(px + 0.5, py + 0.5, x, y, w, h, r)) paint(px, py, rgb, a);
    }
  }
}

/** 圆环扇形（耳机头梁、唱片高光） */
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

/** 柔和弧形反光：角度和半径方向都做衰减，避免硬边扇形 */
function sheenArc(cx, cy, r0, r1, a0, a1, strength, rgb = [255, 255, 255]) {
  for (let py = Math.floor(cy - r1); py <= Math.ceil(cy + r1); py++) {
    for (let px = Math.floor(cx - r1); px <= Math.ceil(cx + r1); px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d < r0 || d > r1) continue;
      let ang = Math.atan2(dy, dx);
      if (ang < 0) ang += Math.PI * 2;
      if (ang < a0 || ang > a1) continue;
      const ta = (ang - a0) / (a1 - a0);
      const tr = (d - r0) / (r1 - r0);
      const a = Math.sin(Math.PI * ta) * Math.sin(Math.PI * tr) * strength;
      paint(px, py, rgb, a);
    }
  }
}

function quad(p0, c, p1, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    pts.push([
      mt * mt * p0[0] + 2 * mt * t * c[0] + t * t * p1[0],
      mt * mt * p0[1] + 2 * mt * t * c[1] + t * t * p1[1],
    ]);
  }
  return pts;
}

function strokeTapered(pts, r0, r1, rgb) {
  const n = pts.length - 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    fillCircle(pts[i][0], pts[i][1], r0 + (r1 - r0) * t, rgb);
  }
}

const WHITE = [255, 255, 255];

// ---------- 各方案 ----------
const VARIANTS = {
  /** 音符：最直白的「音乐」语义 */
  note() {
    tile(16 * k, 16 * k, 480 * k, 480 * k, 116 * k, [252, 128, 148], [178, 14, 56]);
    fillEllipseRot(182 * k, 350 * k, 66 * k, 51 * k, -0.38, WHITE);
    fillRoundRect(228 * k, 124 * k, 34 * k, 232 * k, 17 * k, WHITE);
    strokeTapered(quad([250 * k, 128 * k], [344 * k, 166 * k], [292 * k, 234 * k], 48), 21 * k, 6 * k, WHITE);
  },

  /** 黑胶唱片：质感强，缩到 32px 仍有辨识度 */
  vinyl() {
    tile(16 * k, 16 * k, 480 * k, 480 * k, 116 * k, [252, 128, 148], [178, 14, 56]);
    fillCircle(256 * k, 256 * k, 166 * k, [22, 22, 28]);
    for (const r of [148, 130, 112, 94]) fillRing(256 * k, 256 * k, r * k, (r + 2.4) * k, [56, 56, 66]);
    sheenArc(256 * k, 256 * k, 62 * k, 164 * k, Math.PI * 1.10, Math.PI * 1.42, 0.16);
    fillCircle(256 * k, 256 * k, 56 * k, [250, 250, 252]);
    fillCircle(256 * k, 256 * k, 11 * k, [22, 22, 28]);
  },

  /** 频谱条：最简洁，像「正在播放」 */
  wave() {
    tile(16 * k, 16 * k, 480 * k, 480 * k, 116 * k, [252, 128, 148], [178, 14, 56]);
    const bars = [
      [130, 104],
      [192, 196],
      [256, 272],
      [320, 196],
      [382, 104],
    ];
    const w = 42 * k;
    for (const [cx, h] of bars) {
      const hh = h * k;
      fillRoundRect(cx * k - w / 2, 256 * k - hh / 2, w, hh, w / 2, WHITE);
    }
  },

  /** 耳机：偏「听」的语义，比音符更有识别度 */
  headphone() {
    tile(16 * k, 16 * k, 480 * k, 480 * k, 116 * k, [252, 128, 148], [178, 14, 56]);
    fillArc(256 * k, 268 * k, 132 * k, 176 * k, Math.PI, Math.PI * 2, WHITE);
    fillRoundRect(96 * k, 256 * k, 76 * k, 132 * k, 34 * k, WHITE);
    fillRoundRect(340 * k, 256 * k, 76 * k, 132 * k, 34 * k, WHITE);
  },
};

const name = process.argv[2] || 'note';
const outName = process.argv[3] || (name === 'note' ? 'icon.png' : `icon-${name}.png`);

VARIANTS[name]();

// 降采样
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

writeFileSync(new URL(`../public/${outName}`, import.meta.url), png);
console.log(`${outName} written:`, png.length, 'bytes');
