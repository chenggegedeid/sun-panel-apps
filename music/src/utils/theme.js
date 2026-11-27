/**
 * 外观样式：透明 / 毛玻璃 / 纯色
 */

export function hexToRgba(hex, alpha = 1) {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

export const DEFAULT_CONFIG = {
  bgMode: 'transparent', // transparent | frosted | solid
  bgColor: '#12141c',
  bgOpacity: 32,
  radius: 14,
  textMode: 'auto', // auto | light | dark | custom
  textColor: '#1d1d1f',
  accent: '#f43f5e',
  showName: true,
  showStatus: true,
  textShadow: true,
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

  const sub = hexToRgba(text, 0.66);
  const faint = hexToRgba(text, 0.46);

  let surface = 'background: transparent;';
  let border = '1px solid transparent';
  let shadow = 'none';

  if (c.bgMode === 'frosted' || c.bgMode === 'solid') {
    const a = Math.max(0, Math.min(100, Number(c.bgOpacity) || 0)) / 100;
    surface = `background: ${hexToRgba(c.bgColor, a)};`;
    if (c.bgMode === 'frosted') {
      surface += ' backdrop-filter: blur(16px) saturate(140%); -webkit-backdrop-filter: blur(16px) saturate(140%);';
      border = `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.42)'}`;
    } else {
      border = `1px solid ${hexToRgba(text, 0.08)}`;
    }
    shadow = '0 1px 2px rgba(15,23,42,0.06)';
  }

  const textShadow = c.textShadow
    ? `0 1px 3px ${isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)'}, 0 0 1px ${isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.12)'}`
    : 'none';

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
