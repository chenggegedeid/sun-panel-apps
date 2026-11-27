/**
 * 数字、流量、时长的显示格式
 */

/** 1234 → 1,234；12345 → 1.2万 */
export function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(abs >= 1e9 ? 0 : 1)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(abs >= 1e5 ? 0 : 1)}万`;
  if (abs >= 1000) return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(abs % 1 === 0 ? 0 : 1);
  return v.toFixed(abs % 1 === 0 ? 0 : 2);
}

/** 字节数：1.9 GB */
export function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  return `${x >= 100 ? x.toFixed(0) : x.toFixed(x >= 10 ? 1 : 2)} ${units[i]}`;
}

/** 每秒字节数：1.9 MB/s */
export function fmtBps(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0 B/s';
  return `${fmtBytes(v)}/s`;
}

/** 比特每秒（网络口径）：15.7 Mbps */
export function fmtBits(n) {
  const v = Number(n) * 8;
  if (!Number.isFinite(v) || v <= 0) return '0 bps';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  let i = 0;
  let x = v;
  while (x >= 1000 && i < units.length - 1) {
    x /= 1000;
    i += 1;
  }
  return `${x >= 100 ? x.toFixed(0) : x.toFixed(1)} ${units[i]}`;
}

/** 秒数 → 3 天 4 小时 */
export function fmtDuration(sec) {
  const v = Math.max(0, Math.floor(Number(sec) || 0));
  if (v < 60) return `${v} 秒`;
  const d = Math.floor(v / 86400);
  const h = Math.floor((v % 86400) / 3600);
  const m = Math.floor((v % 3600) / 60);
  if (d > 0) return h > 0 ? `${d} 天 ${h} 小时` : `${d} 天`;
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
  return `${m} 分`;
}

/** unix 秒 → 刚刚 / 3 分钟前 */
export function fmtAgo(unixSec) {
  const t = Number(unixSec);
  if (!Number.isFinite(t) || t <= 0) return '—';
  const diff = Math.max(0, Date.now() / 1000 - t);
  if (diff < 45) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(t * 1000).toLocaleDateString('zh-CN');
}

/** 时间点 → 14:59:07 */
export function fmtClock(ts) {
  const t = typeof ts === 'number' ? ts * 1000 : Date.parse(ts);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleTimeString('zh-CN', { hour12: false });
}

/** 日期字符串 → 11-27 14:59 */
export function fmtDateTime(ts) {
  if (!ts) return '—';
  // 数字既可能是秒（接口常见）也可能是毫秒（从 PEM 解析出来的），按位数区分
  const t = typeof ts === 'number' ? (ts > 1e12 ? ts : ts * 1000) : Date.parse(ts);
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 剩余天数（证书等），可为负 */
export function daysLeft(v) {
  // 既支持 ISO 字符串（接口常见），也支持毫秒时间戳（从 PEM 解析出来的）
  const t = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return (t - Date.now()) / 86400000;
}

/** 0.38 → 38% */
export function fmtPct(v, digits = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '–';
  return `${n.toFixed(digits)}%`;
}

/** 取一个「整」的刻度上限：13.9 → 20，1400 → 2000，61 → 100 */
export function niceTop(v) {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  const m = v / e;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return step * e;
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, Number(v) || 0));
}
