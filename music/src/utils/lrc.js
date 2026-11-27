/**
 * LRC / 结构化歌词的公共工具
 *
 * 卡片和窗口都要「当前唱到哪一句」，统一放这里，避免两份实现跑偏。
 */

/**
 * LRC 文本 → { synced, lines: [{ start, text }] }
 * start 为秒，null 表示没有时间轴
 */
export function parseLrc(text) {
  if (!text) return null;
  const lines = [];
  const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  let synced = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const tags = [...raw.matchAll(re)];
    const content = raw.replace(re, '').trim();
    if (!tags.length) {
      if (content) lines.push({ start: null, text: content });
      continue;
    }
    synced = true;
    for (const m of tags) {
      const sec = Number(m[1]) * 60 + Number(m[2]) + Number(m[3] || 0) / 1000;
      lines.push({ start: sec, text: content });
    }
  }
  if (!lines.length) return null;
  if (synced) lines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  return { synced, lines };
}

/** 当前时间对应的行号，没有时间轴返回 -1 */
export function lineIndexAt(lyrics, t) {
  const lines = lyrics?.lines;
  if (!lyrics?.synced || !lines?.length) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].start;
    if (s != null && s <= t + 0.15) idx = i;
    else if (s != null) break;
  }
  return idx;
}

/**
 * 当前该显示的那句词
 * 段落之间常有空行，往前找最近一句有字的
 */
export function currentLine(lyrics, t) {
  const idx = lineIndexAt(lyrics, t);
  if (idx < 0) return { index: -1, text: '' };
  const lines = lyrics.lines;
  for (let i = idx; i >= 0 && i > idx - 4; i--) {
    const text = (lines[i].text || '').trim();
    if (text) return { index: i, text };
  }
  return { index: idx, text: '' };
}
