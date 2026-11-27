import { SunPanelPageElement } from '@sun-panel/micro-app';
import { html, css } from 'lit';
import { DEFAULT_CONFIG, resolveConfig, hexToRgba } from '../utils/theme.js';
import { normalizeServers, normalizeBase, ping, uid, hostOf, SubsonicError,
  setRequestAdapter,
} from '../utils/subsonic.js';
import { PROVIDERS, pingServer, providerMeta } from '../utils/provider.js';

const BG_MODES = [
  { value: 'transparent', label: '完全透明', desc: '不画底色，直接透出壁纸' },
  { value: 'frosted', label: '毛玻璃', desc: '半透明 + 背景模糊' },
  { value: 'solid', label: '纯色', desc: '自定义颜色与不透明度' },
];

const TEXT_MODES = [
  { value: 'auto', label: '跟随深浅色' },
  { value: 'light', label: '浅色文字' },
  { value: 'dark', label: '深色文字' },
  { value: 'custom', label: '自定义' },
];

const ACCENTS = ['#f43f5e', '#0ea5e9', '#8b5cf6', '#22a06b', '#f5a524', '#64748b'];

const PRESETS = [
  { name: 'Navidrome', hint: 'http://192.168.1.10:4533' },
  { name: 'Gonic', hint: 'http://192.168.1.10:4747' },
  { name: 'Airsonic', hint: 'http://192.168.1.10:4040' },
  { name: 'Jellyfin', hint: 'http://192.168.1.10:8096' },
];

export class MusicConfig extends SunPanelPageElement {
  static properties = {
    servers: { state: true },
    activeId: { state: true },
    bgMode: { state: true },
    bgColor: { state: true },
    bgOpacity: { state: true },
    radius: { state: true },
    textMode: { state: true },
    textColor: { state: true },
    accent: { state: true },
    showName: { state: true },
    showStatus: { state: true },
    testResult: { state: true },
    saving: { state: true },
    toast: { state: true },
    loading: { state: true },
  };

  constructor() {
    super();
    this.servers = [];
    this.activeId = '';
    this.bgMode = DEFAULT_CONFIG.bgMode;
    this.bgColor = DEFAULT_CONFIG.bgColor;
    this.bgOpacity = DEFAULT_CONFIG.bgOpacity;
    this.radius = DEFAULT_CONFIG.radius;
    this.textMode = DEFAULT_CONFIG.textMode;
    this.textColor = DEFAULT_CONFIG.textColor;
    this.accent = DEFAULT_CONFIG.accent;
    this.showName = DEFAULT_CONFIG.showName;
    this.showStatus = DEFAULT_CONFIG.showStatus;
    this.testResult = {};
    this.saving = false;
    this.toast = '';
    this.loading = true;
  }

  _bindNetwork() {
    const net = this.spCtx?.api?.network;
    if (net?.request) setRequestAdapter((opts) => net.request(opts));
  }

  onInitialized({ widgetInfo } = {}) {
    this._bindNetwork();
    const cfg = resolveConfig(widgetInfo?.config);
    this.bgMode = cfg.bgMode;
    this.bgColor = cfg.bgColor;
    this.bgOpacity = cfg.bgOpacity;
    this.radius = cfg.radius;
    this.textMode = cfg.textMode;
    this.textColor = cfg.textColor;
    this.accent = cfg.accent;
    this.showName = cfg.showName;
    this.showStatus = cfg.showStatus;
    this._load();
  }

  async _load() {
    try {
      const dn = this.spCtx?.api?.dataNode?.user;
      const list = await dn?.getByKey('music', 'servers');
      const active = await dn?.getByKey('music', 'activeId');
      this.servers = normalizeServers(list);
      this.activeId = active || this.servers.find((s) => s.default)?.id || this.servers[0]?.id || '';
    } catch {
      this.servers = [];
    }
    this.loading = false;
  }

  _notify(msg) {
    this.toast = msg;
    this.requestUpdate();
    setTimeout(() => {
      this.toast = '';
      this.requestUpdate();
    }, 2600);
  }

  _add(preset) {
    const s = {
      id: uid(),
      name: preset ? preset.name : '我的音乐',
      url: '',
      user: '',
      password: '',
      type: 'subsonic',
      default: this.servers.length === 0,
    };
    this.servers = [...this.servers, s];
    if (!this.activeId) this.activeId = s.id;
  }

  _update(id, patch) {
    this.servers = this.servers.map((s) => (s.id === id ? { ...s, ...patch } : s));
  }

  _remove(id) {
    this.servers = this.servers.filter((s) => s.id !== id);
    if (this.activeId === id) this.activeId = this.servers[0]?.id || '';
  }

  async _test(s) {
    if (!s.url) {
      this._notify('先填地址');
      return;
    }
    this.testResult = { ...this.testResult, [s.id]: { state: 'testing' } };
    try {
      const body = await pingServer({
        ...s,
        url: normalizeBase(s.url),
        type: s.type || 'subsonic',
      });
      this.testResult = {
        ...this.testResult,
        [s.id]: { state: 'ok', text: `${body.type || 'Subsonic'} ${body.serverVersion || ''}`.trim() },
      };
    } catch (e) {
      this.testResult = {
        ...this.testResult,
        [s.id]: { state: 'fail', text: e instanceof SubsonicError ? e.message : '连接失败' },
      };
    }
  }

  async handleSave() {
    this.saving = true;
    try {
      const clean = this.servers
        .filter((s) => s.url && s.url.trim())
        .map((s) => ({
          id: s.id,
          name: (s.name || hostOf(s.url)).trim(),
          url: normalizeBase(s.url),
          user: (s.user || '').trim(),
          password: s.password || '',
          type: s.type || 'subsonic',
          default: s.id === this.activeId,
        }));

      if (!clean.length) {
        this._notify('至少要有一个填好地址的服务器');
        this.saving = false;
        return;
      }

      const settings = {
        bgMode: this.bgMode,
        bgColor: this.bgColor,
        bgOpacity: Number(this.bgOpacity),
        radius: Number(this.radius),
        textMode: this.textMode,
        textColor: this.textColor,
        accent: this.accent,
        showName: !!this.showName,
        showStatus: !!this.showStatus,
        activeId: this.activeId || clean[0]?.id || '',
      };

      const dn = this.spCtx?.api?.dataNode?.user;
      await dn?.setByKey('music', 'servers', clean);
      await dn?.setByKey('music', 'activeId', settings.activeId);
      // 外观优先存数据节点：卡片会优先读这里，不依赖 widget.save 是否成功
      await dn?.setByKey('music', 'settings', settings);

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
      setTimeout(() => this.spCtx?.api?.window?.close?.(), 500);
    } catch (e) {
      this._notify(`保存失败：${e?.message || e}`);
    } finally {
      this.saving = false;
    }
  }

  _previewStyle() {
    let bg = 'transparent';
    let extra = '';
    if (this.bgMode === 'frosted' || this.bgMode === 'solid') {
      bg = hexToRgba(this.bgColor, this.bgOpacity / 100);
      if (this.bgMode === 'frosted') extra = 'backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);';
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

  _testTip(s) {
    const r = this.testResult[s.id];
    if (!r) return '测试';
    if (r.state === 'testing') return '测试中…';
    if (r.state === 'ok') return `✓ ${r.text || '可连接'}`;
    return '✕ 连不上';
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
    const activeSrv = this.servers.find((s) => s.id === this.activeId);
    return html`
      <div class="wrap ${this._dark ? 'dark' : ''}">
        <header class="head">
          <div>
            <h1>音乐</h1>
            <p>
              连接自建音乐服务：Subsonic 协议（Navidrome / Gonic / Airsonic / Jellyfin）或简听，
              卡片点开就是播放器，歌单、封面、进度都在面板里。
            </p>
          </div>
          <button class="primary sm" ?disabled=${this.saving} @click=${this.handleSave}>
            ${this.saving ? '保存中…' : '保存'}
          </button>
        </header>

        <section class="card">
          <div class="card-head">
            <h2>服务器</h2>
            <span class="hint">${this.servers.length} 个</span>
          </div>

          ${this.loading
    ? html`<p class="muted">载入中…</p>`
    : this.servers.length
      ? html`<div class="list">
                  ${this.servers.map(
    (s) => html`<div class="item ${s.id === this.activeId ? 'on' : ''}">
                      <div class="item-row">
                        <label class="radio">
                          <input
                            type="radio"
                            name="active"
                            .checked=${s.id === this.activeId}
                            @change=${() => (this.activeId = s.id)}
                          />
                        </label>
                        <input
                          class="name"
                          .value=${s.name}
                          placeholder="名称，如 家里的 NAS"
                          @input=${(e) => this._update(s.id, { name: e.target.value })}
                        />
                        <button class="del" title="删除" @click=${() => this._remove(s.id)}>×</button>
                      </div>
                      <div class="item-row">
                        <select
                          class="stype"
                          .value=${s.type || 'subsonic'}
                          @change=${(e) => this._update(s.id, { type: e.target.value })}
                        >
                          ${PROVIDERS.map(
    (p) => html`<option value=${p.id} ?selected=${(s.type || 'subsonic') === p.id}>
                              ${p.label}
                            </option>`,
  )}
                        </select>
                        <input
                          class="url"
                          .value=${s.url}
                          placeholder=${providerMeta(s.type).fields.find((f) => f.key === 'url')?.placeholder || 'http://地址:端口'}
                          @input=${(e) => this._update(s.id, { url: e.target.value })}
                        />
                        <button
                          class="ghost sm ${this.testResult[s.id]?.state || ''}"
                          @click=${() => this._test(s)}
                        >
                          ${this._testTip(s)}
                        </button>
                      </div>
                      <div class="item-row">
                        <input
                          class="cred"
                          .value=${s.user}
                          placeholder="用户名"
                          @input=${(e) => this._update(s.id, { user: e.target.value })}
                        />
                        <input
                          class="cred"
                          type="password"
                          .value=${s.password}
                          placeholder="密码"
                          @input=${(e) => this._update(s.id, { password: e.target.value })}
                        />
                      </div>
                      ${this.testResult[s.id]?.state === 'fail'
    ? html`<div class="err">${this.testResult[s.id].text}</div>`
    : ''}
                    </div>`,
  )}
                </div>`
      : html`<p class="muted">还没有服务器，先加一个。</p>`}

          <div class="add-row">
            ${PRESETS.map(
    (p) => html`<button class="ghost" @click=${() => this._add(p)}>＋ ${p.name}</button>`,
  )}
            <button class="ghost" @click=${() => this._add(null)}>＋ 自定义</button>
          </div>

          <p class="tip">
            地址填到端口那一层就行，例如 <code>https://m.example.com:4433</code>。
            <b>Navidrome 的网页地址末尾带 /app 的话要去掉</b>，接口在根路径的 <code>/rest</code> 下。
            账号密码是你音乐服务里的账号，不是面板的。
          </p>
        </section>

        <section class="card">
          <div class="card-head"><h2>卡片背景</h2><span class="hint">实时预览</span></div>
          <div class="preview-wrap">
            <div class="preview" style="${this._previewStyle()}">
              <span class="p-ico"></span>
              <span class="p-name">${activeSrv?.name || '音乐'}</span>
              <span class="p-status">${this.showStatus ? '已连接' : ''}</span>
            </div>
          </div>
          <div class="seg">
            ${BG_MODES.map(
    (m) => html`<button class="seg-item ${this.bgMode === m.value ? 'on' : ''}" @click=${() => (this.bgMode = m.value)}>
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
    : ''}

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
    (c) => html`<button class="dot ${this.accent === c ? 'on' : ''}" style="background:${c}" @click=${() => (this.accent = c)}></button>`,
  )}
              <input type="color" .value=${this.accent} @input=${(e) => (this.accent = e.target.value)} />
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2>卡片显示</h2></div>
          <label class="switch">
            <input type="checkbox" .checked=${this.showName} @change=${(e) => (this.showName = e.target.checked)} />
            <span>显示服务器名称</span>
          </label>
          <label class="switch">
            <input type="checkbox" .checked=${this.showStatus} @change=${(e) => (this.showStatus = e.target.checked)} />
            <span>显示连接状态（每分钟探测一次）</span>
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
      scrollbar-width: thin;
      /* 自带底色：不依赖宿主窗口背景，避免深色窗口里深字看不见 */
      background: linear-gradient(160deg, #eef2fb 0%, #f7f1f8 100%);
    }
    .wrap.dark {
      background: linear-gradient(160deg, #1a1d26 0%, #241d29 100%);
    }
    .head {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .head h1 {
      font-size: 18px;
      margin: 0 0 4px;
      font-weight: 600;
    }
    .head p {
      margin: 0;
      font-size: 12px;
      line-height: 1.65;
      color: rgba(0, 0, 0, 0.55);
      max-width: 520px;
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
    .list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .item {
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 10px;
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.6);
    }
    .item.on {
      border-color: #f43f5e;
      background: rgba(244, 63, 94, 0.05);
    }
    .item-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .item-row + .item-row {
      margin-top: 6px;
    }
    .radio input {
      accent-color: #f43f5e;
    }
    input.name {
      flex: 1;
      min-width: 100px;
      font-size: 13px;
      font-weight: 500;
      border: none;
      background: transparent;
      padding: 3px 2px;
      color: inherit;
      outline: none;
      border-bottom: 1px solid transparent;
    }
    input.name:focus {
      border-bottom-color: rgba(244, 63, 94, 0.6);
    }
    select.stype {
      font-size: 12px;
      padding: 5px 6px;
      border-radius: 7px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      background: #fff;
      color: inherit;
      outline: none;
      flex: none;
    }
    .dark select.stype {
      background: rgba(0, 0, 0, 0.28);
      border-color: rgba(255, 255, 255, 0.12);
    }
    input.url,
    input.cred {
      flex: 1;
      min-width: 0;
      font-size: 12px;
      padding: 5px 8px;
      border-radius: 6px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      background: #fff;
      color: inherit;
      outline: none;
    }
    input.url {
      font-family: ui-monospace, Menlo, monospace;
    }
    input.url:focus,
    input.cred:focus {
      border-color: rgba(244, 63, 94, 0.5);
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
      white-space: nowrap;
    }
    .ghost:hover {
      border-color: #f43f5e;
      color: #f43f5e;
    }
    .ghost.sm {
      padding: 5px 10px;
      font-size: 11.5px;
      border-style: solid;
    }
    .ghost.ok {
      border-color: rgba(34, 160, 107, 0.5);
      color: #15803d;
    }
    .ghost.fail {
      border-color: rgba(229, 72, 77, 0.5);
      color: #be123c;
    }
    .err {
      margin-top: 6px;
      font-size: 11.5px;
      line-height: 1.6;
      color: #be123c;
      background: rgba(244, 63, 94, 0.07);
      border-radius: 6px;
      padding: 5px 8px;
    }
    .tip {
      font-size: 11.5px;
      line-height: 1.7;
      color: rgba(0, 0, 0, 0.5);
      background: rgba(244, 63, 94, 0.06);
      border-radius: 8px;
      padding: 8px 10px;
      margin: 10px 0 0;
    }
    .tip code {
      font-family: ui-monospace, monospace;
      background: rgba(0, 0, 0, 0.06);
      padding: 0 3px;
      border-radius: 3px;
      font-size: 11px;
    }
    .tip b {
      color: #be123c;
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
      gap: 8px;
      padding: 8px 12px;
    }
    .p-ico {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: linear-gradient(135deg, #fb7185, #e11d48);
      flex: none;
    }
    .p-name {
      font-size: 13px;
      font-weight: 500;
    }
    .p-status {
      font-size: 11px;
      opacity: 0.6;
      margin-left: auto;
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
      border-color: #f43f5e;
      background: rgba(244, 63, 94, 0.08);
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
      color: #f43f5e;
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
      accent-color: #f43f5e;
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
      border-color: #f43f5e;
      background: rgba(244, 63, 94, 0.1);
      color: #be123c;
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
      accent-color: #f43f5e;
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
      background: #f43f5e;
      color: #fff;
      cursor: pointer;
      box-shadow: 0 6px 16px rgba(244, 63, 94, 0.3);
    }
    .primary.sm {
      padding: 7px 18px;
      font-size: 12.5px;
      box-shadow: none;
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
    .dark .item.on {
      border-color: rgba(244, 63, 94, 0.55);
      background: rgba(244, 63, 94, 0.12);
    }
    .dark input.name {
      color: #e8eaf0;
    }
    .dark input.url,
    .dark input.cred {
      background: rgba(0, 0, 0, 0.28);
      border-color: rgba(255, 255, 255, 0.12);
      color: #e8eaf0;
    }
    .dark input.url::placeholder,
    .dark input.cred::placeholder,
    .dark input.name::placeholder {
      color: rgba(255, 255, 255, 0.28);
    }
    .dark .del {
      color: rgba(255, 255, 255, 0.34);
    }
    .dark .del:hover {
      background: rgba(244, 63, 94, 0.18);
      color: #fda4af;
    }
    .dark .ghost {
      border-color: rgba(255, 255, 255, 0.18);
      color: rgba(255, 255, 255, 0.72);
    }
    .dark .ghost:hover {
      border-color: rgba(244, 63, 94, 0.6);
      color: #fda4af;
    }
    .dark .ghost.ok {
      border-color: rgba(34, 197, 94, 0.5);
      color: #86efac;
    }
    .dark .ghost.fail {
      border-color: rgba(244, 63, 94, 0.5);
      color: #fda4af;
    }
    .dark .err {
      color: #fda4af;
      background: rgba(244, 63, 94, 0.14);
    }
    .dark .tip {
      color: rgba(255, 255, 255, 0.55);
      background: rgba(244, 63, 94, 0.1);
    }
    .dark .tip code {
      background: rgba(255, 255, 255, 0.1);
      color: #e8eaf0;
    }
    .dark .tip b {
      color: #fda4af;
    }
    .dark .seg-item {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.1);
      color: #e8eaf0;
    }
    .dark .seg-item.on {
      border-color: rgba(244, 63, 94, 0.6);
      background: rgba(244, 63, 94, 0.14);
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
      border-color: rgba(244, 63, 94, 0.6);
      background: rgba(244, 63, 94, 0.16);
      color: #fecdd3;
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
    .dark .preview {
      color: #e8eaf0;
    }
    .dark .toast {
      background: rgba(255, 255, 255, 0.92);
      color: #15171a;
    }
  `;
}
