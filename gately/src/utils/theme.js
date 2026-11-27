/**
 * 外观：透明 / 毛玻璃 / 纯色，文字色可跟随深浅色或自定义，指标小块各有自己的颜色
 */

export function hexToRgba(hex, alpha = 1) {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

/** 卡片上可选的指标，顺序即默认显示顺序 */
export const METRICS = [
  { key: 'qps', label: '请求速率', unit: 'QPS', color: '#34d399' },
  { key: 'bw', label: '实时带宽', unit: '', color: '#38bdf8' },
  { key: 'conn', label: '处理中', unit: '', color: '#a78bfa' },
  { key: 'sites', label: '站点', unit: '', color: '#818cf8' },
  { key: 'bans', label: '封禁 IP', unit: '', color: '#fb7185' },
  { key: 'blocked', label: '拦截', unit: '', color: '#fb923c' },
  { key: 'cpu', label: 'CPU', unit: '', color: '#fbbf24' },
  { key: 'mem', label: '内存', unit: '', color: '#f472b6' },
  { key: 'requests', label: '累计请求', unit: '', color: '#60a5fa' },
];

export const DEFAULT_METRICS = ['qps', 'bw', 'conn', 'sites', 'bans', 'cpu'];

export const DEFAULT_CONFIG = {
  bgMode: 'transparent', // transparent | frosted | solid
  bgColor: '#0f1513',
  bgOpacity: 46,
  radius: 14,
  textMode: 'auto', // auto | light | dark | custom
  textColor: '#15171a',
  accent: '#18a888',
  title: '',
  metrics: DEFAULT_METRICS,
  trend: 'auto', // auto | bps | qps | none
  refresh: 15,
};

export function resolveConfig(raw) {
  const c = { ...DEFAULT_CONFIG, ...(raw || {}) };
  // 老版本存过别的字段时，兜住坏值
  if (!Array.isArray(c.metrics) || !c.metrics.length) c.metrics = DEFAULT_METRICS.slice();
  c.metrics = c.metrics.filter((k) => METRICS.some((m) => m.key === k));
  if (!c.metrics.length) c.metrics = DEFAULT_METRICS.slice();
  c.radius = Math.min(28, Math.max(0, Number(c.radius) || 0));
  c.refresh = Math.min(300, Math.max(5, Number(c.refresh) || 15));
  return c;
}

export function buildTheme(cfg, darkMode) {
  const c = resolveConfig(cfg);
  const isDark = !!darkMode;

  let text;
  if (c.textMode === 'custom') text = c.textColor;
  else if (c.textMode === 'light') text = '#f7f7fa';
  else if (c.textMode === 'dark') text = '#15171a';
  else text = isDark ? '#f2f2f7' : '#15171a';

  const sub = hexToRgba(text, 0.62);
  const faint = hexToRgba(text, 0.42);

  let surface = 'background: transparent;';
  let border = '1px solid transparent';
  let shadow = 'none';

  if (c.bgMode === 'frosted' || c.bgMode === 'solid') {
    const a = Math.max(0, Math.min(100, Number(c.bgOpacity) || 0)) / 100;
    surface = `background: ${hexToRgba(c.bgColor, a)};`;
    if (c.bgMode === 'frosted') {
      surface += ' backdrop-filter: blur(18px) saturate(150%); -webkit-backdrop-filter: blur(18px) saturate(150%);';
      border = `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.5)'}`;
    } else {
      border = `1px solid ${hexToRgba(text, 0.08)}`;
    }
    shadow = isDark ? '0 6px 22px rgba(0,0,0,0.28)' : '0 2px 10px rgba(15,23,42,0.08)';
  }

  // 指标小块的底色：深色底用一点白，浅色底用一点墨，否则浅色壁纸上会看不出块
  const chipBg = () => (isDark ? 'rgba(255,255,255,0.055)' : 'rgba(15,23,42,0.062)');

  return {
    text,
    sub,
    faint,
    accent: c.accent,
    accentSoft: hexToRgba(c.accent, 0.14),
    hairline: hexToRgba(text, 0.1),
    chipBg,
    surface,
    border,
    shadow,
    textShadow: isDark
      ? '0 1px 3px rgba(0,0,0,0.5)'
      : '0 1px 2px rgba(255,255,255,0.45)',
    radius: c.radius,
    isDark,
    cfg: c,
  };
}
