/**
 * 农历 / 节气 工具
 * 支持 1900-2100 年，公历农历互转与二十四节气
 */

const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
];

const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const DAY_NAMES = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];

/** 农历月份 / 日期选项（供界面下拉使用） */
export const LUNAR_MONTH_LABELS = MONTH_NAMES.map((n) => `${n}月`);
export const LUNAR_DAY_LABELS = DAY_NAMES;

const TERM_NAMES = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑',
  '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
];

const TERM_INFO = [
  0, 21208, 42467, 63836, 85337, 107014, 128867, 150921,
  173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033,
  353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758,
];

export const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function lYearDays(y) {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += LUNAR_INFO[y - 1900] & i ? 1 : 0;
  return sum + leapDays(y);
}

function leapMonth(y) {
  return LUNAR_INFO[y - 1900] & 0xf;
}

function leapDays(y) {
  if (!leapMonth(y)) return 0;
  return LUNAR_INFO[y - 1900] & 0x10000 ? 30 : 29;
}

function monthDays(y, m) {
  return LUNAR_INFO[y - 1900] & (0x10000 >> m) ? 30 : 29;
}

/**
 * 公历转农历
 * @returns {{lYear:number,lMonth:number,lDay:number,isLeap:boolean,monthName:string,dayName:string,text:string}}
 */
export function solarToLunar(y, m, d) {
  const date = new Date(y, m - 1, d);
  // 以 1900-01-31（农历 1900 年正月初一）为基准
  let offset = Math.floor((date.getTime() - new Date(1900, 0, 31).getTime()) / 86400000);
  let lYear = 1900;
  let temp = 0;

  for (; lYear < 2101 && offset > 0; lYear++) {
    temp = lYearDays(lYear);
    offset -= temp;
  }
  if (offset < 0) {
    offset += temp;
    lYear--;
  }

  const leap = leapMonth(lYear);
  let isLeap = false;
  let lMonth = 1;
  let daysInMonth = 0;

  for (; lMonth < 13 && offset > 0; lMonth++) {
    if (leap > 0 && lMonth === leap + 1 && !isLeap) {
      --lMonth;
      isLeap = true;
      daysInMonth = leapDays(lYear);
    } else {
      daysInMonth = monthDays(lYear, lMonth);
    }
    offset -= daysInMonth;
    if (isLeap && lMonth === leap + 1) isLeap = false;
  }

  if (offset === 0 && leap > 0 && lMonth === leap + 1) {
    if (isLeap) {
      isLeap = false;
    } else {
      isLeap = true;
      --lMonth;
    }
  }
  if (offset < 0) {
    offset += daysInMonth;
    --lMonth;
  }

  const lDay = offset + 1;
  if (lMonth > 12) {
    lMonth = 1;
    lYear++;
  }

  return {
    lYear,
    lMonth,
    lDay,
    isLeap,
    monthName: `${isLeap ? '闰' : ''}${MONTH_NAMES[lMonth - 1]}月`,
    dayName: DAY_NAMES[lDay - 1],
    text: `${MONTH_NAMES[lMonth - 1]}月${DAY_NAMES[lDay - 1]}`,
  };
}

/** 农历转公历 */
export function lunarToSolar(lYear, lMonth, lDay, isLeap = false) {
  let offset = 0;
  for (let y = 1900; y < lYear; y++) offset += lYearDays(y);

  const leap = leapMonth(lYear);
  for (let m = 1; m < lMonth; m++) {
    offset += monthDays(lYear, m);
    if (leap && m === leap && isLeap) offset += leapDays(lYear);
  }
  if (leap === lMonth && isLeap) offset += monthDays(lYear, lMonth);
  offset += lDay - 1;

  const base = new Date(1900, 0, 31);
  base.setDate(base.getDate() + offset);
  return { year: base.getFullYear(), month: base.getMonth() + 1, day: base.getDate() };
}

/** 某年第 n 个节气（n: 0-23）的日期 */
export function getTermDay(y, n) {
  const ms = 31556925974.7 * (y - 1900) + TERM_INFO[n] * 60000;
  const date = new Date(ms + Date.UTC(1900, 0, 6, 2, 5));
  return date.getUTCDate();
}

/** 节气名，当天没有节气返回 null */
export function getTerm(y, m, d) {
  const n1 = (m - 1) * 2;
  if (getTermDay(y, n1) === d) return TERM_NAMES[n1];
  const n2 = n1 + 1;
  if (n2 < 24 && getTermDay(y, n2) === d) return TERM_NAMES[n2];
  return null;
}

/** 农历节日（按农历月日匹配） */
export const LUNAR_FESTIVALS = [
  { name: '春节', month: 1, day: 1, emoji: '🧨' },
  { name: '元宵节', month: 1, day: 15, emoji: '🏮' },
  { name: '龙抬头', month: 2, day: 2, emoji: '🐉' },
  { name: '端午节', month: 5, day: 5, emoji: '🌿' },
  { name: '七夕节', month: 7, day: 7, emoji: '💫' },
  { name: '中元节', month: 7, day: 15, emoji: '🕯️' },
  { name: '中秋节', month: 8, day: 15, emoji: '🥮' },
  { name: '重阳节', month: 9, day: 9, emoji: '🌾' },
  { name: '腊八节', month: 12, day: 8, emoji: '🥣' },
  { name: '小年', month: 12, day: 23, emoji: '🍬' },
];

/** 公历节日 */
export const SOLAR_FESTIVALS = [
  { name: '元旦', month: 1, day: 1, emoji: '🎊' },
  { name: '情人节', month: 2, day: 14, emoji: '💐' },
  { name: '妇女节', month: 3, day: 8, emoji: '🌷' },
  { name: '植树节', month: 3, day: 12, emoji: '🌱' },
  { name: '愚人节', month: 4, day: 1, emoji: '🎭' },
  { name: '劳动节', month: 5, day: 1, emoji: '🛠️' },
  { name: '儿童节', month: 6, day: 1, emoji: '🎈' },
  { name: '建党节', month: 7, day: 1, emoji: '🚩' },
  { name: '建军节', month: 8, day: 1, emoji: '🎖️' },
  { name: '教师节', month: 9, day: 10, emoji: '📚' },
  { name: '国庆节', month: 10, day: 1, emoji: '🇨🇳' },
  { name: '光棍节', month: 11, day: 11, emoji: '🛒' },
  { name: '平安夜', month: 12, day: 24, emoji: '🎄' },
  { name: '圣诞节', month: 12, day: 25, emoji: '🎁' },
];

/** 某天的农历节日 / 节气 / 公历节日名（用于月历上标注） */
export function getDayLabel(y, m, d) {
  const term = getTerm(y, m, d);
  if (term) return term;
  const lunar = solarToLunar(y, m, d);
  const lf = LUNAR_FESTIVALS.find((f) => f.month === lunar.lMonth && f.day === lunar.lDay && !lunar.isLeap);
  if (lf) return lf.name;
  const sf = SOLAR_FESTIVALS.find((f) => f.month === m && f.day === d);
  if (sf) return sf.name;
  if (lunar.lDay === 1) return lunar.monthName;
  return lunar.dayName;
}

/**
 * 某个农历节日在指定年份的公历日期
 */
export function lunarFestivalDate(year, month, day) {
  const solar = lunarToSolar(year, month, day, false);
  return solar;
}
