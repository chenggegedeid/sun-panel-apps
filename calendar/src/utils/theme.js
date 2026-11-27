/**
 * 外观样式：透明 / 毛玻璃 / 纯色 三种背景模式
 * 关键点：容器不画任何不透明底色，卡片背景由宿主通过 isModifyBackground 置为 transparent
 */

export function hexToRgba(hex, alpha = 1) {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return `rgba(255,255,255,${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const DEFAULT_CONFIG = {
  // transparent | frosted | solid
  bgMode: 'transparent',
  bgColor: '#0b1220',
  bgOpacity: 28,
  radius: 14,
  // auto | light | dark | custom
  textMode: 'auto',
  textColor: '#1d1d1f',
  accent: '#0ea5e9',
  showLunar: true,
  includeFestivals: true,
  textShadow: true,
  cardShadow: false,
  compact: false,
};

export function resolveConfig(raw) {
  return { ...DEFAULT_CONFIG, ...(raw || {}) };
}

export function buildTheme(cfg, darkMode) {
  const c = resolveConfig(cfg);
  const isDark = !!darkMode;

  let text;
  if (c.textMode === 'custom') text = c.textColor;
  else if (c.textMode === 'light') text = '#f7f7fa';
  else if (c.textMode === 'dark') text = '#15171a';
  else text = isDark ? '#f2f2f7' : '#15171a';

  const sub = c.textMode === 'custom' ? hexToRgba(c.textColor, 0.66) : hexToRgba(text, 0.66);
  const faint = hexToRgba(text, 0.46);

  let surface = 'background: transparent;';
  let border = '1px solid transparent';
  let shadow = 'none';

  if (c.bgMode === 'frosted') {
    const a = Math.max(0, Math.min(100, Number(c.bgOpacity) || 0)) / 100;
    surface = `background: ${hexToRgba(c.bgColor, a)}; backdrop-filter: blur(16px) saturate(140%); -webkit-backdrop-filter: blur(16px) saturate(140%);`;
    border = `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.42)'}`;
    shadow = '0 1px 2px rgba(15,23,42,0.06)';
  } else if (c.bgMode === 'solid') {
    const a = Math.max(0, Math.min(100, Number(c.bgOpacity) || 0)) / 100;
    surface = `background: ${hexToRgba(c.bgColor, a)};`;
    border = `1px solid ${hexToRgba(text, 0.08)}`;
    shadow = '0 1px 2px rgba(15,23,42,0.06)';
  }

  if (c.cardShadow && c.bgMode !== 'transparent') {
    shadow = '0 6px 20px rgba(15,23,42,0.12)';
  }

  const textShadow = c.textShadow ? `0 1px 3px ${isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)'}, 0 0 1px ${isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.12)'}` : 'none';

  return {
    text,
    sub,
    faint,
    accent: c.accent,
    accentSoft: hexToRgba(c.accent, 0.14),
    hairline: hexToRgba(text, 0.12),
    surface,
    border,
    shadow,
    textShadow,
    radius: Number(c.radius) || 14,
    isDark,
    cfg: c,
  };
}
