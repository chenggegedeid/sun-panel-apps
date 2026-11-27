import { html, css } from 'lit';
import { SunPanelPageElement } from '@sun-panel/micro-app';
import { WEEK_NAMES, getDayLabel, solarToLunar } from '../utils/lunar.js';
import { buildTimeline, daysUntil, urgencyColor } from '../utils/events.js';

export class MainPage extends SunPanelPageElement {
  static properties = {
    now: { state: true },
    monthOffset: { state: true },
    timeline: { state: true },
    selected: { state: true },
    loading: { state: true },
  };

  constructor() {
    super();
    this.now = new Date();
    this.monthOffset = 0;
    this.timeline = [];
    this.selected = null;
    this.loading = true;
  }

  async onInitialized() {
    await this._load();
  }

  onDisconnected() {
    this._timer && this.spCtx?.api?.timer?.clearInterval(this._timer);
  }

  async _load() {
    try {
      const list = (await this.spCtx?.api?.dataNode?.user?.getByKey('events', 'list')) || [];
      this._events = Array.isArray(list) ? list : [];
    } catch {
      this._events = [];
    }
    this.timeline = buildTimeline({
      events: this._events,
      includeFestivals: true,
      today: new Date(this.now.getFullYear(), this.now.getMonth(), this.now.getDate()),
    });
    this.loading = false;
  }

  _openConfig() {
    this.spCtx?.api?.window?.open?.({
      componentName: 'calendar-config',
      title: '日历设置',
      windowConfig: { width: 780, height: 720, resize: true },
    });
  }

  _cells() {
    const base = new Date(this.now.getFullYear(), this.now.getMonth() + this.monthOffset, 1);
    const y = base.getFullYear();
    const m = base.getMonth();
    const startPad = base.getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const rows = Math.ceil((startPad + days) / 7);
    const today = this.now;
    const out = [];
    for (let i = 0; i < rows * 7; i++) {
      const d = new Date(y, m, i - startPad + 1);
      const inMonth = d.getMonth() === m;
      out.push({
        day: d.getDate(),
        inMonth,
        date: d,
        isToday:
          d.getFullYear() === today.getFullYear() &&
          d.getMonth() === today.getMonth() &&
          d.getDate() === today.getDate(),
        label: inMonth ? getDayLabel(d.getFullYear(), d.getMonth() + 1, d.getDate()) : '',
        lunar: inMonth ? solarToLunar(d.getFullYear(), d.getMonth() + 1, d.getDate()) : null,
      });
    }
    return { cells: out, rows };
  }

  _select(cell) {
    this.selected = {
      date: cell.date,
      lunar: cell.lunar,
      label: cell.label,
      days: daysUntil(new Date(cell.date.getFullYear(), cell.date.getMonth(), cell.date.getDate())),
    };
  }

  render() {
    const base = new Date(this.now.getFullYear(), this.now.getMonth() + this.monthOffset, 1);
    const { cells, rows } = this._cells();
    const sel = this.selected;
    return html`
      <div class="wrap">
        <div class="cal-panel">
          <div class="cal-head">
            <div class="ym">
              <b>${base.getFullYear()}年${base.getMonth() + 1}月</b>
              <span>${this.now.getMonth() === base.getMonth() && this.now.getFullYear() === base.getFullYear() ? '本月' : ''}</span>
            </div>
            <div class="nav">
              <button @click=${() => (this.monthOffset -= 1)}>‹</button>
              <button @click=${() => (this.monthOffset = 0)}>今天</button>
              <button @click=${() => (this.monthOffset += 1)}>›</button>
            </div>
          </div>

          <div class="week">
            ${WEEK_NAMES.map((w, i) => html`<span class=${i === 0 || i === 6 ? 'end' : ''}>周${w}</span>`)}
          </div>
          <div class="grid" style="grid-template-rows: repeat(${rows}, minmax(0, 1fr));">
            ${cells.map(
    (c) => html`<button
                class="cell ${c.inMonth ? '' : 'dim'} ${c.isToday ? 'today' : ''} ${sel && sel.date.getTime() === c.date.getTime() ? 'sel' : ''}"
                @click=${() => c.inMonth && this._select(c)}
              >
                <span class="num">${c.day}</span>
                <span class="lbl">${c.label}</span>
              </button>`,
  )}
          </div>

          <div class="detail">
            ${sel
    ? html`<span class="d-date">${sel.date.getMonth() + 1}月${sel.date.getDate()}日 · 周${WEEK_NAMES[sel.date.getDay()]}</span>
                  <span class="d-lunar">${sel.lunar ? `${sel.lunar.lYear}年 ${sel.lunar.monthName}${sel.lunar.dayName}` : ''}</span>
                  <span class="d-label">${sel.label || ''}</span>`
    : html`<span class="d-lunar">点选日期查看农历</span>`}
          </div>
        </div>

        <aside class="side">
          <div class="side-head">
            <h2>即将到来</h2>
            <button class="link" @click=${this._openConfig}>编辑事件</button>
          </div>
          <div class="list">
            ${this.loading
    ? html`<p class="muted">载入中…</p>`
    : this.timeline.slice(0, 12).map(
      (i) => html`<div class="item" style="--accent:${urgencyColor(i.days)}">
                    <span class="emoji">${i.emoji}</span>
                    <div class="meta">
                      <span class="t">${i.title}</span>
                      <span class="s">${i.date.getMonth() + 1}月${i.date.getDate()}日${i.isFestival ? ' · 节日' : ''}</span>
                    </div>
                    <span class="days">${i.days === 0 ? '今天' : html`${i.days}<i>天</i>`}</span>
                  </div>`,
    )}
            ${!this.loading && !this.timeline.length ? html`<p class="muted">暂无倒计时</p>` : ''}
          </div>
        </aside>
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
      color: #15171a;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    .wrap {
      height: 100%;
      box-sizing: border-box;
      padding: 16px 18px;
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(240px, 1fr);
      gap: 14px;
      overflow: hidden;
    }
    .cal-panel,
    .side {
      background: rgba(255, 255, 255, 0.74);
      border: 1px solid rgba(0, 0, 0, 0.06);
      border-radius: 14px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .cal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .ym b {
      font-size: 15px;
      font-weight: 600;
    }
    .ym span {
      font-size: 11px;
      color: #0ea5e9;
      margin-left: 6px;
    }
    .nav {
      display: flex;
      gap: 4px;
    }
    .nav button {
      border: 1px solid rgba(0, 0, 0, 0.1);
      background: #fff;
      border-radius: 8px;
      font-size: 12px;
      padding: 3px 9px;
      cursor: pointer;
      color: rgba(0, 0, 0, 0.6);
    }
    .nav button:hover {
      color: #0ea5e9;
      border-color: #0ea5e9;
    }
    .week {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      font-size: 11px;
      color: rgba(0, 0, 0, 0.4);
      text-align: center;
      margin-bottom: 4px;
    }
    .week .end {
      color: rgba(0, 0, 0, 0.55);
    }
    .grid {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      grid-template-rows: repeat(6, 1fr);
      gap: 2px;
      min-height: 0;
    }
    .cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
      border: none;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      padding: 0;
      min-height: 0;
      color: inherit;
    }
    .cell:hover {
      background: rgba(14, 165, 233, 0.08);
    }
    .cell .num {
      font-size: 14px;
      font-weight: 500;
    }
    .cell .lbl {
      font-size: 10px;
      color: rgba(0, 0, 0, 0.42);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cell.dim {
      opacity: 0.28;
      cursor: default;
    }
    .cell.today .num {
      color: #0ea5e9;
      font-weight: 600;
    }
    .cell.today {
      background: rgba(14, 165, 233, 0.1);
    }
    .cell.sel {
      outline: 1.5px solid #0ea5e9;
    }
    .detail {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(0, 0, 0, 0.07);
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      min-height: 22px;
    }
    .d-date {
      font-weight: 600;
    }
    .d-lunar {
      color: rgba(0, 0, 0, 0.55);
    }
    .d-label {
      margin-left: auto;
      color: #0ea5e9;
    }
    .side-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .side-head h2 {
      font-size: 13px;
      margin: 0;
      font-weight: 600;
    }
    .link {
      border: none;
      background: transparent;
      color: #0ea5e9;
      font-size: 11.5px;
      cursor: pointer;
      padding: 2px 4px;
    }
    .list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-height: 0;
      scrollbar-width: thin;
      scrollbar-color: rgba(0, 0, 0, 0.18) transparent;
      padding-right: 2px;
    }
    .list::-webkit-scrollbar {
      width: 4px;
    }
    .list::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.16);
      border-radius: 4px;
    }
    .item {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 6px 6px 10px;
      border-radius: 8px;
    }
    .item:hover {
      background: rgba(0, 0, 0, 0.03);
    }
    .item::before {
      content: '';
      position: absolute;
      left: 0;
      top: 8px;
      bottom: 8px;
      width: 2px;
      border-radius: 2px;
      background: var(--accent);
    }
    .emoji {
      font-size: 14px;
    }
    .meta {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .t {
      font-size: 12.5px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .s {
      font-size: 10.5px;
      color: rgba(0, 0, 0, 0.42);
    }
    .days {
      font-size: 15px;
      font-weight: 600;
      color: var(--accent);
      flex: none;
    }
    .days i {
      font-size: 10px;
      font-style: normal;
      margin-left: 1px;
      opacity: 0.75;
    }
    .muted {
      font-size: 12px;
      color: rgba(0, 0, 0, 0.42);
    }
    @media (max-width: 640px) {
      .wrap {
        grid-template-columns: 1fr;
        overflow-y: auto;
      }
    }
  `;
}
