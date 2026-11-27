import { SunPanelPageElement } from '@sun-panel/micro-app';
import { html, css } from 'lit';
import { DEFAULT_CONFIG, resolveConfig, hexToRgba } from '../utils/theme.js';
import { EVENT_TYPES, formatDate, nextOccurrence, daysUntil } from '../utils/events.js';

const BG_MODES = [
  { value: 'transparent', label: '完全透明', desc: '不画底色，直接透出壁纸 / 卡片背景' },
  { value: 'frosted', label: '毛玻璃', desc: '半透明 + 背景模糊' },
  { value: 'solid', label: '纯色', desc: '自定义颜色与不透明度' },
];

const TEXT_MODES = [
  { value: 'auto', label: '跟随深浅色' },
  { value: 'light', label: '浅色文字' },
  { value: 'dark', label: '深色文字' },
  { value: 'custom', label: '自定义' },
];

const ACCENTS = ['#0ea5e9', '#22a06b', '#e5484d', '#f5a524', '#8b5cf6', '#ec4899', '#64748b'];

export class WidgetConfig extends SunPanelPageElement {
  static properties = {
    events: { state: true },
    bgMode: { state: true },
    bgColor: { state: true },
    bgOpacity: { state: true },
    radius: { state: true },
    textMode: { state: true },
    textColor: { state: true },
    accent: { state: true },
    showLunar: { state: true },
    includeFestivals: { state: true },
    textShadow: { state: true },
    saving: { state: true },
    toast: { state: true },
    loading: { state: true },
  };

  constructor() {
    super();
    this.events = [];
    this.bgMode = DEFAULT_CONFIG.bgMode;
    this.bgColor = DEFAULT_CONFIG.bgColor;
    this.bgOpacity = DEFAULT_CONFIG.bgOpacity;
    this.radius = DEFAULT_CONFIG.radius;
    this.textMode = DEFAULT_CONFIG.textMode;
    this.textColor = DEFAULT_CONFIG.textColor;
    this.accent = DEFAULT_CONFIG.accent;
    this.showLunar = DEFAULT_CONFIG.showLunar;
    this.includeFestivals = DEFAULT_CONFIG.includeFestivals;
    this.textShadow = DEFAULT_CONFIG.textShadow;
    this.saving = false;
    this.toast = '';
    this.loading = true;
  }

  onInitialized({ widgetInfo } = {}) {
    const cfg = resolveConfig(widgetInfo?.config);
    this.bgMode = cfg.bgMode;
    this.bgColor = cfg.bgColor;
    this.bgOpacity = cfg.bgOpacity;
    this.radius = cfg.radius;
    this.textMode = cfg.textMode;
    this.textColor = cfg.textColor;
    this.accent = cfg.accent;
    this.showLunar = cfg.showLunar;
    this.includeFestivals = cfg.includeFestivals;
    this.textShadow = cfg.textShadow;
    this._loadEvents();
  }

  async _loadEvents() {
    try {
      const list = (await this.spCtx?.api?.dataNode?.user?.getByKey('events', 'list')) || [];
      this.events = Array.isArray(list) ? list.map((e) => ({ ...e })) : [];
    } catch {
      this.events = [];
    }
    this.loading = false;
  }

  _notify(msg) {
    this.toast = msg;
    this.requestUpdate();
    setTimeout(() => {
      this.toast = '';
      this.requestUpdate();
    }, 2200);
  }

  _uid() {
    return `e${Date.now().toString(36)}${Math.floor(Math.random() * 999).toString(36)}`;
  }

  _addEvent(type = 'birthday') {
    this.events = [
      ...this.events,
      {
        id: this._uid(),
        title: type === 'birthday' ? '我的生日' : type === 'anniversary' ? '纪念日' : '重要日子',
        date: formatDate(new Date()),
        type,
        yearly: true,
        emoji: EVENT_TYPES[type]?.emoji || '📌',
      },
    ];
  }

  _updateEvent(id, patch) {
    this.events = this.events.map((e) => (e.id === id ? { ...e, ...patch } : e));
  }

  _removeEvent(id) {
    this.events = this.events.filter((e) => e.id !== id);
  }

  async handleSave() {
    this.saving = true;
    try {
      // 事件写入数据节点（用户级，跨卡片共享）
      const clean = this.events
        .filter((e) => e.title && e.date)
        .map((e) => ({
          id: e.id,
          title: e.title.trim(),
          date: e.date,
          type: e.type || 'reminder',
          yearly: !!e.yearly,
          emoji: e.emoji || EVENT_TYPES[e.type]?.emoji || '📌',
        }));
      await this.spCtx?.api?.dataNode?.user?.setByKey('events', 'list', clean);

      // 卡片配置 + 关键一步：把宿主卡片背景也设为透明
      const settings = {
        bgMode: this.bgMode,
        bgColor: this.bgColor,
        bgOpacity: Number(this.bgOpacity),
        radius: Number(this.radius),
        textMode: this.textMode,
        textColor: this.textColor,
        accent: this.accent,
        showLunar: !!this.showLunar,
        includeFestivals: !!this.includeFestivals,
        textShadow: !!this.textShadow,
      };

      // 兜底：外观也存进数据节点，widget.save 失败时卡片仍能读到
      await this.spCtx?.api?.dataNode?.user?.setByKey('events', 'settings', settings);

      let widgetSaved = true;
      try {
        await this.spCtx?.api?.widget?.save({
          widgetId: this.spCtx?.widgetInfo?.widgetId,
          gridSize: this.spCtx?.widgetInfo?.gridSize || '2x2',
          title: this.spCtx?.widgetInfo?.title || '',
          background: 'transparent',
          config: settings,
        });
      } catch {
        widgetSaved = false;
      }

      this._notify(widgetSaved ? '已保存' : '已保存（外观存在应用数据里）');
      setTimeout(() => this.spCtx?.api?.window?.close?.(), 380);
    } catch (e) {
      this._notify(`保存失败：${e?.message || e}`);
    } finally {
      this.saving = false;
    }
  }

  _previewStyle() {
    let bg = 'transparent';
    let extra = '';
    if (this.bgMode === 'frosted') {
      bg = hexToRgba(this.bgColor, this.bgOpacity / 100);
      extra = 'backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);';
    } else if (this.bgMode === 'solid') {
      bg = hexToRgba(this.bgColor, this.bgOpacity / 100);
    }
    const color =
      this.textMode === 'custom'
        ? this.textColor
        : this.textMode === 'light'
          ? '#f7f7fa'
          : this.textMode === 'dark'
            ? '#15171a'
            : this.spCtx?.darkMode
              ? '#f2f2f7'
              : '#15171a';
    return `background:${bg};color:${color};border-radius:${this.radius}px;${extra}`;
  }

  _eventPreview(e) {
    const next = nextOccurrence(e);
    return next ? daysUntil(next) : null;
  }

  get _dark() {
    const ctx = this.spCtx;
    if (typeof ctx?.darkMode === 'boolean') return ctx.darkMode;
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }

  render() {
    return html`
      <div class="wrap ${this._dark ? 'dark' : ''}">
        <header class="head">
          <div>
            <h1>日历倒计时</h1>
            <p>管理倒计时事件，并调整卡片外观。背景默认完全透明。</p>
          </div>
          <div class="head-right">
            <button class="primary sm" ?disabled=${this.saving} @click=${this.handleSave}>
              ${this.saving ? '保存中…' : '保存'}
            </button>
          </div>
        </header>

        <section class="card">
          <div class="card-head">
            <h2>倒计时事件</h2>
            <span class="hint">${this.events.length} 个</span>
          </div>

          ${this.loading
    ? html`<p class="muted">载入中…</p>`
    : this.events.length
      ? html`<div class="list">
                  ${this.events.map(
    (e) => html`<div class="item">
                      <div class="item-row">
                        <input
                          class="title"
                          .value=${e.title}
                          placeholder="事件名称"
                          @input=${(ev) => this._updateEvent(e.id, { title: ev.target.value })}
                        />
                        <button class="del" title="删除" @click=${() => this._removeEvent(e.id)}>×</button>
                      </div>
                      <div class="item-row">
                        <input
                          class="date"
                          type="date"
                          .value=${e.date}
                          @change=${(ev) => this._updateEvent(e.id, { date: ev.target.value })}
                        />
                        <select
                          class="type"
                          .value=${e.type || 'reminder'}
                          @change=${(ev) => this._updateEvent(e.id, { type: ev.target.value })}
                        >
                          ${Object.entries(EVENT_TYPES).map(
    ([k, v]) => html`<option value=${k} ?selected=${(e.type || 'reminder') === k}>
                              ${v.emoji} ${v.label}
                            </option>`,
  )}
                        </select>
                        <label class="yearly">
                          <input
                            type="checkbox"
                            .checked=${!!e.yearly}
                            @change=${(ev) => this._updateEvent(e.id, { yearly: ev.target.checked })}
                          />
                          每年重复
                        </label>
                        ${e.yearly && this._eventPreview(e) != null
    ? html`<span class="left-days">${this._eventPreview(e)} 天后</span>`
    : ''}
                      </div>
                    </div>`,
  )}
                </div>`
      : html`<p class="muted">还没有事件，添加一个生日或纪念日吧。</p>`}

          <div class="add-row">
            <button class="ghost" @click=${() => this._addEvent('birthday')}>＋ 生日</button>
            <button class="ghost" @click=${() => this._addEvent('anniversary')}>＋ 纪念日</button>
            <button class="ghost" @click=${() => this._addEvent('reminder')}>＋ 重要日子</button>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2>背景</h2><span class="hint">实时预览</span></div>
          <div class="preview-wrap">
            <div class="preview" style="${this._previewStyle()}">
              <span class="p-label">${this.includeFestivals ? '春节' : '我的生日'}</span>
              <span class="p-mid">距离目标日</span>
              <span class="p-num" style="color:${this.accent}">63<i>天</i></span>
            </div>
          </div>
          <div class="seg">
            ${BG_MODES.map(
    (m) => html`<button
                class="seg-item ${this.bgMode === m.value ? 'on' : ''}"
                @click=${() => (this.bgMode = m.value)}
              >
                <span class="seg-title">${m.label}</span>
                <span class="seg-desc">${m.desc}</span>
              </button>`,
  )}
          </div>

          ${this.bgMode !== 'transparent'
    ? html`
                <div class="field">
                  <label>底色</label>
                  <div class="row">
                    <input type="color" .value=${this.bgColor} @input=${(e) => (this.bgColor = e.target.value)} />
                    <span class="code">${this.bgColor}</span>
                  </div>
                </div>
                <div class="field">
                  <label>不透明度 <b>${this.bgOpacity}%</b></label>
                  <input type="range" min="0" max="100" .value=${String(this.bgOpacity)} @input=${(e) => (this.bgOpacity = Number(e.target.value))} />
                </div>
              `
    : html`<p class="tip">透明模式下卡片不画任何底色，文字会自动加一层柔和投影保证可读。如果壁纸太亮，建议换成深色文字或改用毛玻璃。</p>`}

          <div class="field">
            <label>圆角 <b>${this.radius}px</b></label>
            <input type="range" min="0" max="28" .value=${String(this.radius)} @input=${(e) => (this.radius = Number(e.target.value))} />
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2>文字与强调色</h2></div>
          <div class="chips">
            ${TEXT_MODES.map(
    (m) => html`<button class="chip ${this.textMode === m.value ? 'on' : ''}" @click=${() => (this.textMode = m.value)}>
                ${m.label}
              </button>`,
  )}
          </div>
          ${this.textMode === 'custom'
    ? html`<div class="field">
                <label>文字颜色</label>
                <div class="row">
                  <input type="color" .value=${this.textColor} @input=${(e) => (this.textColor = e.target.value)} />
                  <span class="code">${this.textColor}</span>
                </div>
              </div>`
    : ''}
          <div class="field">
            <label>强调色</label>
            <div class="dots">
              ${ACCENTS.map(
    (c) => html`<button
                  class="dot ${this.accent === c ? 'on' : ''}"
                  style="background:${c}"
                  @click=${() => (this.accent = c)}
                ></button>`,
  )}
              <input type="color" .value=${this.accent} @input=${(e) => (this.accent = e.target.value)} />
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2>显示</h2></div>
          <label class="switch">
            <input type="checkbox" .checked=${this.showLunar} @change=${(e) => (this.showLunar = e.target.checked)} />
            <span>显示农历</span>
          </label>
          <label class="switch">
            <input type="checkbox" .checked=${this.includeFestivals} @change=${(e) => (this.includeFestivals = e.target.checked)} />
            <span>内置节日倒计时（春节、中秋、国庆等）</span>
          </label>
          <label class="switch">
            <input type="checkbox" .checked=${this.textShadow} @change=${(e) => (this.textShadow = e.target.checked)} />
            <span>透明背景时给文字加阴影</span>
          </label>
        </section>

        <footer class="foot">
          <button class="primary" ?disabled=${this.saving} @click=${this.handleSave}>
            ${this.saving ? '保存中…' : '保存'}
          </button>
        </footer>

        ${this.toast ? html`<div class="toast">${this.toast}</div>` : ''}
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
      overflow-y: auto;
      box-sizing: border-box;
      padding: 18px 20px 24px;
      /* 自带底色：不依赖宿主窗口背景，避免深色窗口里深字看不见 */
      background: linear-gradient(160deg, #eef2fb 0%, #f7f1f8 100%);
    }
    .wrap.dark {
      background: linear-gradient(160deg, #1a1d26 0%, #241d29 100%);
    }
    .head {
      display: flex;
      gap: 18px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .head-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .primary.sm {
      padding: 7px 18px;
      font-size: 12.5px;
      box-shadow: none;
    }
    .head h1 {
      font-size: 18px;
      margin: 0 0 4px;
      font-weight: 600;
    }
    .head p {
      margin: 0;
      font-size: 12px;
      color: rgba(0, 0, 0, 0.55);
    }
    .preview-wrap {
      margin-bottom: 10px;
      border-radius: 12px;
      padding: 10px;
      border: 1px dashed rgba(0, 0, 0, 0.14);
      background-image: repeating-conic-gradient(rgba(15, 23, 42, 0.045) 0% 25%, transparent 0% 50%);
      background-size: 16px 16px;
    }
    .preview {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 11px 14px;
    }
    .p-label {
      font-size: 14px;
      font-weight: 500;
    }
    .p-mid {
      font-size: 11px;
      opacity: 0.55;
      margin-left: auto;
    }
    .p-num {
      font-size: 26px;
      font-weight: 600;
      line-height: 1;
    }
    .p-num i {
      font-size: 11px;
      font-style: normal;
      margin-left: 2px;
      opacity: 0.8;
    }
    .card {
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid rgba(0, 0, 0, 0.07);
      border-radius: 14px;
      padding: 14px 16px;
      margin-bottom: 12px;
    }
    .card-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .card-head h2 {
      font-size: 14px;
      margin: 0;
      font-weight: 600;
    }
    .hint {
      font-size: 11px;
      color: rgba(0, 0, 0, 0.4);
    }
    .muted {
      font-size: 12px;
      color: rgba(0, 0, 0, 0.45);
      margin: 6px 0;
    }
    .tip {
      font-size: 11.5px;
      line-height: 1.65;
      color: rgba(0, 0, 0, 0.5);
      background: rgba(14, 165, 233, 0.07);
      border-radius: 8px;
      padding: 8px 10px;
      margin: 8px 0 0;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .item {
      border: 1px solid rgba(0, 0, 0, 0.06);
      border-radius: 10px;
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.6);
    }
    .item-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .item-row + .item-row {
      margin-top: 6px;
    }
    input.title {
      flex: 1;
      min-width: 120px;
      font-size: 13px;
      font-weight: 500;
      border: none;
      border-bottom: 1px solid transparent;
      background: transparent;
      padding: 3px 2px;
      color: inherit;
      outline: none;
    }
    input.title:focus {
      border-bottom-color: rgba(14, 165, 233, 0.6);
    }
    input.date,
    select.type {
      font-size: 12px;
      padding: 4px 6px;
      border-radius: 6px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      background: #fff;
      color: inherit;
      outline: none;
    }
    .yearly {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: rgba(0, 0, 0, 0.6);
      cursor: pointer;
    }
    .left-days {
      font-size: 11px;
      color: #0ea5e9;
      margin-left: auto;
    }
    .del {
      border: none;
      background: transparent;
      font-size: 17px;
      line-height: 1;
      color: rgba(0, 0, 0, 0.3);
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 6px;
    }
    .del:hover {
      background: rgba(229, 72, 77, 0.1);
      color: #e5484d;
    }
    .add-row {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .ghost {
      font-size: 12px;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px dashed rgba(0, 0, 0, 0.18);
      background: transparent;
      color: rgba(0, 0, 0, 0.65);
      cursor: pointer;
    }
    .ghost:hover {
      border-color: #0ea5e9;
      color: #0ea5e9;
    }
    .seg {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .seg-item {
      text-align: left;
      border: 1px solid rgba(0, 0, 0, 0.1);
      background: rgba(255, 255, 255, 0.55);
      border-radius: 10px;
      padding: 8px 10px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .seg-item.on {
      border-color: #0ea5e9;
      background: rgba(14, 165, 233, 0.08);
    }
    .seg-title {
      font-size: 12.5px;
      font-weight: 600;
    }
    .seg-desc {
      font-size: 10.5px;
      line-height: 1.45;
      color: rgba(0, 0, 0, 0.45);
    }
    .field {
      margin-top: 12px;
    }
    .field > label {
      display: block;
      font-size: 12px;
      color: rgba(0, 0, 0, 0.6);
      margin-bottom: 6px;
    }
    .field > label b {
      color: #0ea5e9;
      font-weight: 600;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    input[type='color'] {
      width: 30px;
      height: 24px;
      padding: 0;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
    }
    .code {
      font-size: 11px;
      color: rgba(0, 0, 0, 0.45);
      font-family: ui-monospace, monospace;
    }
    input[type='range'] {
      width: 100%;
      accent-color: #0ea5e9;
    }
    .chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .chip {
      font-size: 12px;
      padding: 5px 10px;
      border-radius: 999px;
      border: 1px solid rgba(0, 0, 0, 0.1);
      background: rgba(255, 255, 255, 0.55);
      cursor: pointer;
      color: rgba(0, 0, 0, 0.7);
    }
    .chip.on {
      border-color: #0ea5e9;
      background: rgba(14, 165, 233, 0.1);
      color: #0369a1;
    }
    .dots {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .dot {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      padding: 0;
    }
    .dot.on {
      border-color: #15171a;
      box-shadow: 0 0 0 2px #fff inset;
    }
    .switch {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12.5px;
      padding: 6px 0;
      cursor: pointer;
      color: rgba(0, 0, 0, 0.72);
    }
    .switch input {
      accent-color: #0ea5e9;
    }
    .foot {
      padding: 4px 0 12px;
      display: flex;
      justify-content: flex-end;
    }
    .primary {
      font-size: 13px;
      font-weight: 600;
      padding: 9px 26px;
      border-radius: 999px;
      border: none;
      background: #0ea5e9;
      color: #fff;
      cursor: pointer;
      box-shadow: 0 6px 16px rgba(14, 165, 233, 0.32);
    }
    .primary:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .toast {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      background: rgba(21, 23, 26, 0.9);
      color: #fff;
      font-size: 12px;
      padding: 8px 16px;
      border-radius: 999px;
      z-index: 20;
    }

    /* ===== 深色模式：窗口背景是深的，文字和卡片要跟着换 ===== */
    .dark {
      color: #e8eaf0;
    }
    .dark .head p,
    .dark .muted {
      color: rgba(255, 255, 255, 0.55);
    }
    .dark .hint {
      color: rgba(255, 255, 255, 0.38);
    }
    .dark .card {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.09);
    }
    .dark .item {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.09);
    }
    .dark input.title {
      color: #e8eaf0;
    }
    .dark input.date,
    .dark select.type {
      background: rgba(0, 0, 0, 0.28);
      border-color: rgba(255, 255, 255, 0.12);
      color: #e8eaf0;
    }
    .dark input.title::placeholder {
      color: rgba(255, 255, 255, 0.28);
    }
    .dark .yearly {
      color: rgba(255, 255, 255, 0.6);
    }
    .dark .del {
      color: rgba(255, 255, 255, 0.34);
    }
    .dark .del:hover {
      background: rgba(229, 72, 77, 0.18);
      color: #fda4af;
    }
    .dark .ghost {
      border-color: rgba(255, 255, 255, 0.18);
      color: rgba(255, 255, 255, 0.72);
    }
    .dark .ghost:hover {
      border-color: rgba(14, 165, 233, 0.6);
      color: #7dd3fc;
    }
    .dark .tip {
      color: rgba(255, 255, 255, 0.55);
      background: rgba(14, 165, 233, 0.1);
    }
    .dark .seg-item {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.1);
      color: #e8eaf0;
    }
    .dark .seg-item.on {
      border-color: rgba(14, 165, 233, 0.6);
      background: rgba(14, 165, 233, 0.14);
    }
    .dark .seg-desc {
      color: rgba(255, 255, 255, 0.45);
    }
    .dark .chip {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.75);
    }
    .dark .chip.on {
      border-color: rgba(14, 165, 233, 0.6);
      background: rgba(14, 165, 233, 0.16);
      color: #bae6fd;
    }
    .dark .field > label,
    .dark .switch {
      color: rgba(255, 255, 255, 0.62);
    }
    .dark .code {
      color: rgba(255, 255, 255, 0.45);
    }
    .dark .dot.on {
      border-color: #fff;
      box-shadow: 0 0 0 2px #0b0d12 inset;
    }
    .dark .preview-wrap {
      border-color: rgba(255, 255, 255, 0.12);
      background-image: repeating-conic-gradient(rgba(255, 255, 255, 0.05) 0% 25%, transparent 0% 50%);
    }
    .dark .toast {
      background: rgba(255, 255, 255, 0.92);
      color: #15171a;
    }
  `;
}
