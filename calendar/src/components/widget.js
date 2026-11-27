import { SunPanelWidgetElement } from '@sun-panel/micro-app';
import { html, css } from 'lit';
import { buildTheme, resolveConfig } from '../utils/theme.js';
import { buildTimeline, urgencyColor } from '../utils/events.js';
import { WEEK_NAMES, getDayLabel, solarToLunar } from '../utils/lunar.js';

export class Widget extends SunPanelWidgetElement {
  static properties = {
    now: { state: true },
    timeline: { state: true },
    loading: { state: true },
    _w: { state: true },
  };

  constructor() {
    super();
    this.now = new Date();
    this.timeline = [];
    this.loading = true;
    this._timer = null;
    this._events = [];
    this._w = 0;
    this._ro = null;
  }

  get cfg() {
    // 数据节点里的 settings 是配置页存的真值，widgetInfo.config 只作兜底
    return resolveConfig({ ...(this.spCtx?.widgetInfo?.config || {}), ...(this._settings || {}) });
  }

  onInitialized() {
    this._load();
    // 定时器必须走 api.timer，主应用才能在卸载时回收
    this._timer = this.spCtx?.api?.timer?.setInterval(() => {
      const d = new Date();
      if (d.getDate() !== this.now.getDate() || d.getMinutes() !== this.now.getMinutes()) {
        this.now = d;
        this._compute();
      }
    }, 30000);
  }

  onWidgetInfoChanged() {
    this._load();
    this.requestUpdate();
  }

  onFirstRendered() {
    this._measure();
    if (typeof ResizeObserver !== 'undefined' && !this._ro) {
      this._ro = new ResizeObserver(() => this._measure());
      this._ro.observe(this);
    }
  }

  /** 记录卡片实际宽度，窄屏时少显示几个倒计时，避免挤成一团 */
  _measure() {
    const w = Math.round(this.getBoundingClientRect().width);
    if (w > 0 && Math.abs(w - this._w) >= 8) this._w = w;
  }

  onDisconnected() {
    if (this._timer != null) {
      this.spCtx?.api?.timer?.clearInterval(this._timer);
      this._timer = null;
    }
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
  }

  async _load() {
    try {
      let list = [];
      const dn = this.spCtx?.api?.dataNode?.user;
      if (dn?.getByKey) list = (await dn.getByKey('events', 'list')) || [];
      else if (dn?.get) list = (await dn.get('events')) || [];
      this._events = Array.isArray(list) ? list : [];
      try {
        const settings = await dn?.getByKey('events', 'settings');
        if (settings) this._settings = settings;
      } catch {
        /* 忽略 */
      }
    } catch {
      this._events = [];
    }
    this.loading = false;
    this._compute();
  }

  _compute() {
    this.timeline = buildTimeline({
      events: this._events || [],
      includeFestivals: this.cfg.includeFestivals,
      today: new Date(this.now.getFullYear(), this.now.getMonth(), this.now.getDate()),
    });
  }

  // ---------- 月历 ----------
  _monthMatrix(year, month) {
    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const rows = Math.ceil((startPad + daysInMonth) / 7);
    const today = this.now;
    const cells = [];
    for (let i = 0; i < rows * 7; i++) {
      const d = new Date(year, month, i - startPad + 1);
      const inMonth = d.getMonth() === month;
      cells.push({
        day: d.getDate(),
        inMonth,
        isToday:
          d.getFullYear() === today.getFullYear() &&
          d.getMonth() === today.getMonth() &&
          d.getDate() === today.getDate(),
        // 非本月只显示日期，避免视觉噪音
        label:
          inMonth && this.cfg.showLunar ? getDayLabel(d.getFullYear(), d.getMonth() + 1, d.getDate()) : '',
      });
    }
    return { cells, rows };
  }

  _monthGrid(theme, opts = {}) {
    const base = new Date(this.now.getFullYear(), this.now.getMonth() + (this.monthOffset || 0), 1);
    const y = base.getFullYear();
    const m = base.getMonth();
    const { cells, rows } = this._monthMatrix(y, m);
    return html`
      <div class="cal">
        <div class="cal-head">
          <span class="cal-title">${y}年${m + 1}月</span>
        </div>
        <div class="cal-week">
          ${WEEK_NAMES.map((w, i) => html`<span class=${i === 0 || i === 6 ? 'wk-end' : ''}>${w}</span>`)}
        </div>
        <div class="cal-grid" style="grid-template-rows: repeat(${rows}, minmax(0, 1fr));">
          ${cells.map(
    (c) => html`<div class="cell ${c.inMonth ? '' : 'dim'} ${c.isToday ? 'today' : ''}">
              <span class="dnum">${c.day}</span>
              ${opts.showLunar && c.label ? html`<span class="lbl">${c.label}</span>` : ''}
            </div>`,
  )}
        </div>
      </div>
    `;
  }

  // ---------- 列表条目 ----------
  _pill(item) {
    const lunar = solarToLunar(item.date.getFullYear(), item.date.getMonth() + 1, item.date.getDate());
    // 横向条空间有限，统一用短格式，避免被截断成「2026-12-15 · …」
    let sub = '';
    if (this.cfg.showLunar) {
      sub = `${item.date.getMonth() + 1}/${item.date.getDate()} · ${lunar.text}`;
    } else {
      sub = `${item.date.getMonth() + 1}月${item.date.getDate()}日`;
    }
    return html`
      <div class="pill" style="--accent:${urgencyColor(item.days)}">
        <div class="pill-left">
          <div class="pill-title"><span class="pill-emoji">${item.emoji}</span>${item.title}</div>
          <div class="pill-sub">${sub}</div>
        </div>
        <div class="pill-ends">
          <span class="pill-mid">距离目标日</span>
          <div class="pill-right">
            ${item.days === 0
    ? html`<span class="num small">今天</span>`
    : html`<span class="num">${item.days}</span><span class="unit">天</span>`}
          </div>
        </div>
      </div>
    `;
  }

  _row(item) {
    const lunar = solarToLunar(item.date.getFullYear(), item.date.getMonth() + 1, item.date.getDate());
    return html`
      <div class="row" style="--accent:${urgencyColor(item.days)}">
        <span class="row-emoji">${item.emoji}</span>
        <div class="row-main">
          <span class="row-title">${item.title}</span>
          <span class="row-sub">
            ${item.calendar === 'lunar'
    ? `农历${lunar.text} · ${item.date.getMonth() + 1}月${item.date.getDate()}日`
    : `${item.date.getMonth() + 1}月${item.date.getDate()}日${this.cfg.showLunar ? ` · 农历${lunar.text}` : ''}`}
          </span>
        </div>
        <span class="row-days">${item.days === 0 ? '今天' : html`${item.days}<i>天</i>`}</span>
      </div>
    `;
  }

  _empty() {
    return html`<div class="empty">还没有倒计时<br /><span>打开应用添加一个</span></div>`;
  }

  // ---------- 尺寸 ----------
  render1x1() {
    const d = this.now;
    const lunar = solarToLunar(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return html`
      <div class="s-1x1">
        <div class="d-xl">${d.getDate()}</div>
        <div class="d-sub">周${WEEK_NAMES[d.getDay()]}</div>
        ${this.cfg.showLunar ? html`<div class="d-lunar">${lunar.text}</div>` : ''}
      </div>
    `;
  }

  render1x2() {
    const d = this.now;
    const lunar = solarToLunar(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return html`
      <div class="s-1x2">
        <div class="d-month">${d.getFullYear()}年${d.getMonth() + 1}月</div>
        <div class="d-xl">${d.getDate()}</div>
        <div class="d-sub">周${WEEK_NAMES[d.getDay()]}</div>
        ${this.cfg.showLunar ? html`<div class="d-lunar">${lunar.text}</div>` : ''}
      </div>
    `;
  }

  render2x1() {
    const d = this.now;
    const lunar = solarToLunar(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const next = this.timeline[0];
    return html`
      <div class="s-2x1">
        <div class="left">
          <div class="d-xl">${d.getDate()}</div>
          <div class="d-sub">${d.getMonth() + 1}月 · 周${WEEK_NAMES[d.getDay()]}</div>
          ${this.cfg.showLunar ? html`<div class="d-lunar">${lunar.text}</div>` : ''}
        </div>
        <div class="vline"></div>
        <div class="right">
          ${next
    ? html`<div class="next-title"><span>${next.emoji}</span>${next.title}</div>
                <div class="next-sub">距离目标日</div>
                <div class="next-days" style="color:${urgencyColor(next.days)}">
                  ${next.days === 0 ? '今天' : html`${next.days}<i>天</i>`}
                </div>`
    : html`<div class="next-sub">暂无倒计时</div>`}
        </div>
      </div>
    `;
  }

  render2x2() {
    return html`<div class="s-cal">${this._monthGrid(buildTheme(this.spCtx?.widgetInfo?.config, this.spCtx?.darkMode))}</div>`;
  }

  render2x4() {
    const list = this.timeline.slice(0, 2);
    return html`
      <div class="s-2x4">
        <div class="cal-wrap">${this._monthGrid(buildTheme(this.spCtx?.widgetInfo?.config, this.spCtx?.darkMode))}</div>
        <div class="hline"></div>
        <div class="rows">${list.length ? list.map((i) => this._row(i)) : this._empty()}</div>
      </div>
    `;
  }

  render4x4() {
    const list = this.timeline.slice(0, 3);
    return html`
      <div class="s-4x4">
        <div class="cal-wrap">
          ${this._monthGrid(buildTheme(this.spCtx?.widgetInfo?.config, this.spCtx?.darkMode), {
    showLunar: this.cfg.showLunar,
  })}
        </div>
        <div class="hline"></div>
        <div class="rows">${list.length ? list.map((i) => this._row(i)) : this._empty()}</div>
      </div>
    `;
  }

  render1xfull() {
    const w = this._w || 0;
    // 窄屏（手机）只放 1–2 个，否则每个只有百来像素会挤成一团
    const max = w > 0 ? (w < 360 ? 1 : w < 600 ? 2 : w < 880 ? 3 : 4) : 3;
    const list = this.timeline.slice(0, max);
    if (!list.length) return this._empty();
    const cls = `${list.length === 1 ? 'one' : ''} ${list.length >= 3 ? 'many' : ''}`;
    return html`<div class="s-1xfull ${cls}">${list.map((i) => this._pill(i))}</div>`;
  }

  render() {
    const size = this.spCtx?.widgetInfo?.gridSize || '2x2';
    const theme = buildTheme(this.spCtx?.widgetInfo?.config, this.spCtx?.darkMode);
    const isTransparent = theme.cfg.bgMode === 'transparent';

    const containerStyle = [
      theme.surface,
      `color:${theme.text}`,
      `border-radius:${theme.radius}px`,
      `border:${theme.border}`,
      `box-shadow:${isTransparent ? 'none' : theme.shadow}`,
      `text-shadow:${isTransparent ? theme.textShadow : 'none'}`,
      `--soft:${theme.sub}`,
      `--faint:${theme.faint}`,
      `--accent:${theme.accent}`,
      `--accent-soft:${theme.accentSoft}`,
      `--hairline:${theme.hairline}`,
    ].join(';');

    if (this.loading) {
      return html`<div class="container" style="${containerStyle}"><div class="empty">载入中…</div></div>`;
    }

    const body = {
      '1x1': () => this.render1x1(),
      '1x2': () => this.render1x2(),
      '2x1': () => this.render2x1(),
      '2x2': () => this.render2x2(),
      '2x4': () => this.render2x4(),
      '4x4': () => this.render4x4(),
      '1xfull': () => this.render1xfull(),
    }[size];

    return html`<div class="container size-${size}" style="${containerStyle}">
      ${body ? body() : this.render2x2()}
    </div>`;
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
      background: transparent;
    }
    .container {
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      display: flex;
      overflow: hidden;
      container-type: inline-size;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
        'Microsoft YaHei', sans-serif;
      background-color: transparent;
      -webkit-font-smoothing: antialiased;
    }
    .container.size-1x1,
    .container.size-1x2,
    .container.size-2x1 {
      padding: 8px 10px;
    }
    .empty {
      margin: auto;
      text-align: center;
      font-size: 12px;
      line-height: 1.6;
      color: var(--soft, rgba(128, 128, 128, 0.8));
      opacity: 0.9;
    }
    .empty span {
      font-size: 11px;
      color: var(--faint, rgba(128, 128, 128, 0.55));
    }

    .d-xl {
      font-size: 40px;
      line-height: 1;
      font-weight: 500;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .d-sub {
      font-size: 12px;
      color: var(--soft);
      font-weight: 400;
    }
    .d-lunar {
      font-size: 11px;
      color: var(--faint);
      letter-spacing: 0.02em;
    }

    .s-1x1 {
      margin: auto;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
      width: 100%;
    }
    .s-1x2 {
      margin: auto;
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      text-align: center;
    }
    .s-1x2 .d-xl {
      font-size: 34px;
    }
    .d-month {
      font-size: 11px;
      color: var(--soft);
    }

    .s-2x1 {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
    }
    .s-2x1 .left {
      text-align: center;
      min-width: 62px;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .s-2x1 .d-xl {
      font-size: 30px;
    }
    .vline {
      width: 1px;
      align-self: stretch;
      margin: 4px 0;
      background: var(--hairline);
    }
    .s-2x1 .right {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .next-title {
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .next-title span {
      margin-right: 4px;
    }
    .next-days {
      font-size: 22px;
      font-weight: 500;
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
    }
    .next-days i,
    .row-days i {
      font-size: 11px;
      font-style: normal;
      margin-left: 2px;
      opacity: 0.75;
    }
    .next-sub {
      font-size: 11px;
      color: var(--faint);
    }

    .s-cal,
    .cal-wrap {
      flex: 1;
      min-width: 0;
      display: flex;
    }
    .cal {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }
    .cal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .cal-title {
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.01em;
    }
    .cal-week {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      font-size: 10px;
      color: var(--faint);
      text-align: center;
      margin-bottom: 2px;
    }
    .wk-end {
      opacity: 0.75;
    }
    .cal-grid {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      grid-template-rows: repeat(6, minmax(0, 1fr));
      gap: 1px;
      min-height: 0;
    }
    .cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      min-height: 0;
      overflow: hidden;
    }
    .cell .dnum {
      font-size: 12px;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .cell .lbl {
      font-size: 9px;
      color: var(--faint);
      line-height: 1.5;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cell.dim .dnum {
      opacity: 0.25;
    }
    .cell.dim .lbl {
      opacity: 0.2;
    }
    .cell.today {
      background: var(--accent);
      color: #fff;
      text-shadow: none;
    }
    .cell.today .lbl {
      color: rgba(255, 255, 255, 0.85);
    }
    .container.size-4x4 .cell .dnum {
      font-size: 14px;
    }
    .container.size-4x4 .cell .lbl {
      font-size: 10px;
    }

    .s-2x4,
    .s-4x4 {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      gap: 8px;
    }
    .hline {
      height: 1px;
      background: var(--hairline);
      flex: none;
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: none;
    }
    .row {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 2px 2px 8px;
      min-width: 0;
    }
    .row::before {
      content: '';
      position: absolute;
      left: 0;
      top: 3px;
      bottom: 3px;
      width: 2px;
      border-radius: 2px;
      background: var(--accent);
    }
    .row-emoji {
      font-size: 13px;
      line-height: 1;
      flex: none;
    }
    .row-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .row-title {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row-sub {
      font-size: 10px;
      color: var(--faint);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row-days {
      font-size: 17px;
      font-weight: 500;
      color: var(--accent);
      flex: none;
      font-variant-numeric: tabular-nums;
    }

    .s-1xfull {
      flex: 1;
      display: flex;
      align-items: stretch;
      gap: 10px;
      min-width: 0;
      overflow: hidden;
    }
    .pill {
      position: relative;
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 4px 0 12px;
      overflow: hidden;
    }
    .pill::before {
      content: '';
      position: absolute;
      left: 0;
      top: 6px;
      bottom: 6px;
      width: 3px;
      border-radius: 3px;
      background: var(--accent);
    }
    .s-1xfull.one .pill {
      flex: 1 1 100%;
    }
    /* 三个以上时「距离目标日」纯属占地方，直接省掉 */
    .s-1xfull.many .pill-mid {
      display: none;
    }
    .pill-left {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .pill-ends {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: none;
    }
    .pill-title {
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pill-emoji {
      margin-right: 4px;
      font-size: 13px;
    }
    .pill-sub {
      font-size: 11px;
      color: var(--faint);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pill-mid {
      font-size: 11px;
      color: var(--faint);
      white-space: nowrap;
      flex: none;
    }
    .pill-right {
      display: flex;
      align-items: baseline;
      gap: 2px;
      flex: none;
      color: var(--accent);
    }
    .pill-right .num {
      font-size: 26px;
      font-weight: 500;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.01em;
    }
    .pill-right .num.small {
      font-size: 17px;
    }
    .pill-right .unit {
      font-size: 11px;
      opacity: 0.8;
    }
    .s-1xfull .pill + .pill {
      border-left: 1px solid var(--hairline);
    }

    /* 1x1 这类小格子：缩字号防止溢出 */
    @container (max-width: 132px) {
      .d-xl {
        font-size: 30px;
      }
      .s-1x2 .d-xl {
        font-size: 28px;
      }
      .d-sub,
      .d-lunar {
        font-size: 10px;
      }
    }

    /* 手机 / 窄卡片：收掉冗余文案，避免文字互相挤压
       用容器查询而不是媒体查询——卡片在面板里只占一小块，
       视口宽不代表卡片宽 */
    @container (max-width: 600px) {
      .s-1xfull {
        gap: 6px;
      }
      .pill {
        gap: 8px;
        padding: 0 2px 0 10px;
      }
      .pill-mid {
        display: none;
      }
      .pill-right .num {
        font-size: 22px;
      }
    }
    @container (max-width: 430px) {
      .pill-sub {
        font-size: 10px;
      }
      .pill-title {
        font-size: 13px;
      }
      .cal-title {
        font-size: 12px;
      }
      .row-sub {
        display: none;
      }
      .next-sub {
        display: none;
      }
    }
  `;
}
