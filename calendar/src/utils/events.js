/**
 * 事件 / 倒计时 计算
 */
import { LUNAR_FESTIVALS, SOLAR_FESTIVALS, getTermDay, solarToLunar, lunarToSolar } from './lunar.js';

export const EVENT_TYPES = {
  birthday: { label: '生日', emoji: '🎂' },
  anniversary: { label: '纪念日', emoji: '💗' },
  reminder: { label: '重要日子', emoji: '📌' },
  festival: { label: '节日', emoji: '🎉' },
};

/** 今天 00:00 */
export function startOfToday(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function parseDate(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatDate(date) {
  if (!date) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** 距离目标日还有多少天（今天为 0） */
export function daysUntil(target, today = startOfToday()) {
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/**
 * 计算事件下一次发生的日期
 */
export function nextOccurrence(event, today = startOfToday()) {
  const date = parseDate(event.date);
  if (!date) return null;
  if (!event.yearly) return date;

  const target = new Date(today.getFullYear(), date.getMonth(), date.getDate());
  if (daysUntil(target, today) < 0) {
    target.setFullYear(target.getFullYear() + 1);
  }
  return target;
}

/** 农历节日在某一年的公历日期 */
function lunarFestivalSolar(year, month, day) {
  const s = lunarToSolar(year, month, day, false);
  if (!s) return null;
  const date = new Date(s.year, s.month - 1, s.day);
  // 校验：闰月年份可能错位，校对一次
  const l = solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
  if (l.isLeap || l.lMonth !== month || l.lDay !== day) return null;
  return date;
}

/**
 * 生成未来 count 天内的节日列表
 */
export function getUpcomingFestivals(today = startOfToday(), days = 400) {
  const list = [];
  const end = new Date(today);
  end.setDate(end.getDate() + days);

  for (let y = today.getFullYear(); y <= end.getFullYear(); y++) {
    for (const f of SOLAR_FESTIVALS) {
      list.push({ ...f, date: new Date(y, f.month - 1, f.day), source: 'solar' });
    }
    for (const f of LUNAR_FESTIVALS) {
      const d = lunarFestivalSolar(y, f.month, f.day);
      if (d) list.push({ ...f, date: d, source: 'lunar' });
    }
    // 清明
    const qingming = new Date(y, 3, getTermDay(y, 6));
    list.push({ name: '清明节', emoji: '🌧️', date: qingming, source: 'term' });
  }

  return list
    .filter((f) => f.date >= today && f.date <= end)
    .map((f) => ({ ...f, days: daysUntil(f.date, today) }))
    .sort((a, b) => a.days - b.days);
}

/**
 * 把用户事件 + 节日合并成展示列表
 */
export function buildTimeline({ events = [], includeFestivals = true, today = startOfToday() } = {}) {
  const items = [];

  for (const e of events) {
    const next = nextOccurrence(e, today);
    if (!next) continue;
    items.push({
      id: e.id,
      title: e.title || '未命名',
      emoji: e.emoji || EVENT_TYPES[e.type]?.emoji || '📌',
      type: e.type || 'reminder',
      date: next,
      days: daysUntil(next, today),
      yearly: !!e.yearly,
      isFestival: false,
    });
  }

  if (includeFestivals) {
    for (const f of getUpcomingFestivals(today, 400)) {
      items.push({
        id: `festival-${f.name}-${formatDate(f.date)}`,
        title: f.name,
        emoji: f.emoji || '🎉',
        type: 'festival',
        date: f.date,
        days: f.days,
        yearly: true,
        isFestival: true,
      });
    }
  }

  const seen = new Set();
  return items
    .filter((i) => {
      const key = `${i.title}-${formatDate(i.date)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return i.days >= 0;
    })
    .sort((a, b) => a.days - b.days || a.title.localeCompare(b.title, 'zh'));
}

/** 日期副标题：2027-05-02 · 农历四月初六 */
export function dateCaption(date) {
  if (!date) return '';
  const l = solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return `${formatDate(date)} · 农历${l.monthName}${l.dayName}`;
}

/** 天数胶囊文案 */
export function daysText(days) {
  if (days === 0) return '就是今天';
  if (days === 1) return '明天';
  return `${days}`;
}

/** 根据剩余天数给一个强调色 */
export function urgencyColor(days) {
  if (days === 0) return '#e5484d';
  if (days <= 3) return '#f5a524';
  if (days <= 30) return '#0ea5e9';
  return '#22a06b';
}
