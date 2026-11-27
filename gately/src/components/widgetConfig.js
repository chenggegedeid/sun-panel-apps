import { SunPanelPageElement } from '@sun-panel/micro-app';
import { html, css } from 'lit';
import { resolveConfig, METRICS, DEFAULT_CONFIG } from '../utils/theme.js';
import { gateway } from '../utils/gateway.js';
import { setRequestAdapter, createClient, normalizeHost } from '../utils/api.js';

const PROBES = [
  { key: 'status', label: '系统状态 status:read', run: (c) => c.status() },
  { key: 'web', label: '站点与拓扑 webservice:read', run: (c) => c.topology() },
  { key: 'guard', label: '封禁与防护 guard:read', run: (c) => c.guardStatus() },
  { key: 'ssl', label: '证书 ssl:read', run: (c) => c.certs() },
  { key: 'ddns', label: '动态域名 ddns:read', run: (c) => c.ddns() },
  { key: 'logs', label: '系统日志 logs:read', run: (c) => c.logs(1) },
];

export class GatelyConfig extends SunPanelPageElement {
  static properties = {
    host: { state: true },
    token: { state: true },
    interval: { state: true },
    title: { state: true },
    metrics: { state: true },
    trend: { state: true },
    bgMode: { state: true },
    bgColor: { state: true },
    bgOpacity: { state: true },
    radius: { state: true },
    textMode: { state: true },
    textColor: { state: true },
    accent: { state: true },
    probing: { state: true },
    probes: { state: true },
    message: { state: true },
    msgKind: { state: true },
    dark: { state: true },
    showToken: { state: true },
  };

  constructor() {
    super();
    this.host = '';
    this.token = '';
    this.interval = DEFAULT_CONFIG.refresh;
    this.title = '';
    this.metrics = DEFAULT_CONFIG.metrics.slice();
    this.trend = 'auto';
    this.bgMode = DEFAULT_CONFIG.bgMode;
    this.bgColor = DEFAULT_CONFIG.bgColor;
    this.bgOpacity = DEFAULT_CONFIG.bgOpacity;
    this.radius = DEFAULT_CONFIG.radius;
    this.textMode = DEFAULT_CONFIG.textMode;
    this.textColor = DEFAULT_CONFIG.textColor;
    this.accent = DEFAULT_CONFIG.accent;
    this.probing = false;
    this.probes = [];
    this.message = '';
    this.msgKind = '';
    this.dark = false;
    this.showToken = false;
  }

  _bindNetwork() {
    const net = this.spCtx?.api?.network;
    if (net?.request) setRequestAdapter((opts) => net.request(opts));
  }

  async onInitialized() {
    this._bindNetwork();
    this.dark = !!this.spCtx?.darkMode;
    try {
      const dn = this.spCtx?.api?.dataNode?.user;
      const [conn, settings] = await Promise.all([
        dn?.getByKey('gately', 'conn'),
        dn?.getByKey('gately', 'settings'),
      ]);
      if (conn) {
        this.host = conn.host || '';
        this.token = conn.token || '';
        this.interval = Number(conn.interval) || DEFAULT_CONFIG.refresh;
      }
      if (settings) {
        const c = resolveConfig(settings);
        this.title = c.title || '';
        this.metrics = c.metrics.slice();
        this.trend = c.trend;
        this.bgMode = c.bgMode;
        this.bgColor = c.bgColor;
        this.bgOpacity = c.bgOpacity;
        this.radius = c.radius;
        this.textMode = c.textMode;
        this.textColor = c.textColor;
        this.accent = c.accent;
        this.interval = c.refresh;
      }
    } catch {
      /* 首次使用，用默认值 */
    }
  }

  // ---------- 指标排序 ----------
  _toggleMetric(key) {
    const on = this.metrics.includes(key);
    this.metrics = on ? this.metrics.filter((k) => k !== key) : [...this.metrics, key];
    if (!this.metrics.length) this.metrics = [key];
  }

  _move(key, dir) {
    const list = this.metrics.slice();
    const i = list.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.metrics = list;
  }

  // ---------- 测试连接 ----------
  async _test() {
    const host = normalizeHost(this.host);
    if (!host) {
      this._say('先填管理地址，例如 http://192.168.1.10:16680', 'err');
      return;
    }
    if (!this.token.trim()) {
      this._say('先填 API 令牌（Gately 后台 → API 令牌，令牌以 gtl_ 开头）', 'err');
      return;
    }
    this.probing = true;
    this.probes = [];
    this.message = '';
    const client = createClient({ host, token: this.token });
    try {
      const status = await client.status();
      this.probes = [
        { key: 'status', label: '系统状态 status:read', ok: true, note: status?.version || '' },
        { key: 'web', label: '站点与拓扑 webservice:read', ok: null },
        { key: 'guard', label: '封禁与防护 guard:read', ok: null },
        { key: 'ssl', label: '证书 ssl:read', ok: null },
        { key: 'ddns', label: '动态域名 ddns:read', ok: null },
        { key: 'logs', label: '系统日志 logs:read', ok: null },
      ];
      const host0 = status?.host?.hostname || '';
      this._say(`连接成功：${status?.version || '未知版本'}${host0 ? ` · ${host0}` : ''}`, 'ok');

      for (const p of PROBES.slice(1)) {
        try {
          await p.run(client);
          const row = this.probes.find((r) => r.key === p.key);
          if (row) row.ok = true;
        } catch (e) {
          const row = this.probes.find((r) => r.key === p.key);
          if (row) {
            row.ok = false;
            row.note = e?.message || '失败';
          }
        }
        this.probes = this.probes.slice();
      }
    } catch (e) {
      this.probes = [];
      this._say(e?.message || '连接失败', 'err');
    } finally {
      this.probing = false;
    }
  }

  _say(text, kind = 'ok') {
    this.message = text;
    this.msgKind = kind;
  }

  // ---------- 保存 ----------
  async _save() {
    const host = normalizeHost(this.host);
    const token = this.token.trim();
    if (!host) {
      this._say('管理地址不能为空', 'err');
      return;
    }
    if (!token) {
      this._say('API 令牌不能为空', 'err');
      return;
    }
    const conn = { host, token, interval: Number(this.interval) || 15 };
    const settings = {
      title: this.title.trim(),
      metrics: this.metrics.slice(),
      trend: this.trend,
      bgMode: this.bgMode,
      bgColor: this.bgColor,
      bgOpacity: Number(this.bgOpacity),
      radius: Number(this.radius),
      textMode: this.textMode,
      textColor: this.textColor,
      accent: this.accent,
      refresh: Number(this.interval) || 15,
    };
    try {
      const dn = this.spCtx?.api?.dataNode?.user;
      await dn?.setByKeys('gately', { conn, settings });
      gateway.configure({ host, token, interval: conn.interval });
      this._say('已保存，卡片会立刻按新地址刷新', 'ok');
    } catch (e) {
      this._say(`保存失败：${e?.message || e}`, 'err');
    }
  }

  _reset() {
    this.title = '';
    this.metrics = DEFAULT_CONFIG.metrics.slice();
    this.trend = 'auto';
    this.bgMode = DEFAULT_CONFIG.bgMode;
    this.bgColor = DEFAULT_CONFIG.bgColor;
    this.bgOpacity = DEFAULT_CONFIG.bgOpacity;
    this.radius = DEFAULT_CONFIG.radius;
    this.textMode = DEFAULT_CONFIG.textMode;
    this.textColor = DEFAULT_CONFIG.textColor;
    this.accent = DEFAULT_CONFIG.accent;
    this.interval = DEFAULT_CONFIG.refresh;
    this._say('外观已复位，记得点保存', 'ok');
  }

  // ---------- 渲染 ----------
  _field(label, input, hint) {
    return html`<label class="field">
      <span class="flabel">${label}</span>
      ${input}
      ${hint ? html`<span class="fhint">${hint}</span>` : ''}
    </label>`;
  }

  _seg(options, value, onChange) {
    return html`<div class="seg">
      ${options.map(
    (o) => html`<button class="segb ${o.v === value ? 'on' : ''}" @click=${() => onChange(o.v)}>${o.t}</button>`,
  )}
    </div>`;
  }

  render() {
    const metricRows = METRICS.map((m) => {
      const idx = this.metrics.indexOf(m.key);
      return html`<div class="mrow">
        <label class="mcheck">
          <input type="checkbox" .checked=${idx >= 0} @change=${() => this._toggleMetric(m.key)} />
          <i class="mc" style="background:${m.color}"></i>
          <span>${m.label}</span>
        </label>
        <span class="morder">
          <button ?disabled=${idx <= 0} @click=${() => this._move(m.key, -1)}>↑</button>
          <button ?disabled=${idx < 0 || idx >= this.metrics.length - 1} @click=${() => this._move(m.key, 1)}>↓</button>
          <em>${idx >= 0 ? idx + 1 : '—'}</em>
        </span>
      </div>`;
    });

    return html`
      <div class="wrap ${this.dark ? 'dark' : ''}">
        <div class="head">
          <div>
            <h1>Gately 设置</h1>
            <p>
              填 Gately 后台的管理地址与 API 令牌。令牌在「设置 → API 令牌」页创建，勾选
              <code>status:read</code>、<code>webservice:read</code>、<code>guard:read</code> 等读权限；
              要启停站点、封禁 IP 还需要对应的 <code>:write</code>。
            </p>
          </div>
          <button class="ghost" @click=${() => this._reset()}>复位外观</button>
        </div>

        <div class="card">
          <div class="card-head"><h2>连接</h2><span class="hint">令牌只存在你自己的面板里</span></div>
          ${this._field(
    '管理地址',
    html`<input
              class="inp"
              .value=${this.host}
              placeholder="http://192.168.1.10:16680"
              @input=${(e) => (this.host = e.target.value)}
            />`,
    '默认管理端口 16680。经 fnOS 网关或反代挂在子路径时，把路径一起写上，例如 https://nas.example.com/app/gately',
  )}
          ${this._field(
    'API 令牌',
    html`<div class="row">
              <input
                class="inp"
                type=${this.showToken ? 'text' : 'password'}
                .value=${this.token}
                placeholder="gtl_xxxxxxxx"
                @input=${(e) => (this.token = e.target.value)}
              />
              <button class="ghost small" @click=${() => (this.showToken = !this.showToken)}>
                ${this.showToken ? '隐藏' : '显示'}
              </button>
            </div>`,
    '只读监控只要 status:read + webservice:read + guard:read；不要再套一层账号密码，令牌本身就是凭证',
  )}
          <div class="row end">
            <button class="primary" @click=${() => this._test()} ?disabled=${this.probing}>
              ${this.probing ? '测试中…' : '测试连接'}
            </button>
            <span class="msg ${this.msgKind}">${this.message}</span>
          </div>
          ${this.probes.length
    ? html`<div class="probes">
                ${this.probes.map(
    (p) => html`<div class="probe ${p.ok === true ? 'ok' : p.ok === false ? 'no' : 'wait'}">
                    <i></i><span>${p.label}</span>
                    <em>${p.ok === true ? '可用' : p.ok === false ? p.note || '无权限' : '检测中'}</em>
                  </div>`,
  )}
              </div>`
    : ''}
          ${this._field(
    '刷新间隔',
    html`<div class="row">
              <input
                class="inp narrow"
                type="number"
                min="5"
                max="300"
                .value=${this.interval}
                @input=${(e) => (this.interval = e.target.value)}
              />
              <span class="unit">秒</span>
            </div>`,
    '卡片按这个间隔取一次状态，最短 5 秒。页面切到后台时不会继续请求',
  )}
        </div>

        <div class="card">
          <div class="card-head">
            <h2>卡片</h2>
            <span class="hint">勾选要显示的指标，用 ↑ ↓ 调顺序，靠前的指标显示在越小的卡片上</span>
          </div>
          ${this._field(
    '标题',
    html`<input
              class="inp"
              .value=${this.title}
              placeholder=${'留空则用主机名'}
              @input=${(e) => (this.title = e.target.value)}
            />`,
  )}
          <div class="metrics">${metricRows}</div>
          ${this._field(
    '趋势曲线',
    this._seg(
      [
        { v: 'auto', t: '自动' },
        { v: 'bps', t: '带宽' },
        { v: 'qps', t: '请求速率' },
        { v: 'none', t: '不显示' },
      ],
      this.trend,
      (v) => (this.trend = v),
    ),
    '曲线是面板自己按刷新间隔累积的采样，刚装上是空的，跑几分钟才有形状',
  )}
        </div>

        <div class="card">
          <div class="card-head"><h2>外观</h2><span class="hint">默认透明，直接贴在你的壁纸上</span></div>
          ${this._field(
    '底色',
    this._seg(
      [
        { v: 'transparent', t: '透明' },
        { v: 'frosted', t: '毛玻璃' },
        { v: 'solid', t: '纯色' },
      ],
      this.bgMode,
      (v) => (this.bgMode = v),
    ),
  )}
          ${this.bgMode !== 'transparent'
    ? html`<div class="row">
                ${this._field(
    '底色值',
    html`<input type="color" class="color" .value=${this.bgColor} @input=${(e) => (this.bgColor = e.target.value)} />`,
  )}
                ${this._field(
    '不透明度',
    html`<div class="row">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      .value=${this.bgOpacity}
                      @input=${(e) => (this.bgOpacity = e.target.value)}
                    />
                    <span class="unit">${this.bgOpacity}%</span>
                  </div>`,
  )}
              </div>`
    : ''}
          ${this._field(
    '文字色',
    this._seg(
      [
        { v: 'auto', t: '跟随明暗' },
        { v: 'light', t: '浅色' },
        { v: 'dark', t: '深色' },
        { v: 'custom', t: '自定义' },
      ],
      this.textMode,
      (v) => (this.textMode = v),
    ),
  )}
          ${this.textMode === 'custom'
    ? this._field(
      '文字颜色',
      html`<input type="color" class="color" .value=${this.textColor} @input=${(e) => (this.textColor = e.target.value)} />`,
    )
    : ''}
          <div class="pair">
            ${this._field(
    '强调色',
    html`<input type="color" class="color" .value=${this.accent} @input=${(e) => (this.accent = e.target.value)} />`,
  )}
            ${this._field(
    '圆角',
    html`<div class="row">
                <input
                  type="range"
                  min="0"
                  max="28"
                  .value=${this.radius}
                  @input=${(e) => (this.radius = e.target.value)}
                />
                <span class="unit">${this.radius}px</span>
              </div>`,
  )}
          </div>
        </div>

        <div class="foot">
          <button class="primary big" @click=${() => this._save()}>保存</button>
          <span class="hint">保存后卡片与主窗口都会用新配置</span>
        </div>
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
      background: linear-gradient(160deg, #eef7f4 0%, #f4f6fb 100%);
      font-size: 13px;
    }
    .wrap.dark {
      background: linear-gradient(160deg, #121a18 0%, #171a21 100%);
      color: #f2f2f7;
    }
    .head {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .head h1 {
      font-size: 18px;
      margin: 0 0 4px;
      font-weight: 650;
    }
    .head p {
      margin: 0;
      font-size: 12px;
      line-height: 1.7;
      color: rgba(0, 0, 0, 0.55);
      max-width: 560px;
    }
    .dark .head p {
      color: rgba(255, 255, 255, 0.55);
    }
    .head code {
      font-size: 11px;
      padding: 1px 4px;
      border-radius: 4px;
      background: rgba(24, 168, 136, 0.14);
      color: #0d7a64;
    }
    .dark .head code {
      background: rgba(52, 211, 153, 0.16);
      color: #6ee7b7;
    }
    .card {
      background: rgba(255, 255, 255, 0.74);
      border: 1px solid rgba(0, 0, 0, 0.07);
      border-radius: 14px;
      padding: 14px 16px 16px;
      margin-bottom: 12px;
    }
    .dark .card {
      background: rgba(255, 255, 255, 0.045);
      border-color: rgba(255, 255, 255, 0.08);
    }
    .card-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .card-head h2 {
      font-size: 13.5px;
      margin: 0;
      font-weight: 650;
    }
    .hint {
      font-size: 11px;
      color: rgba(0, 0, 0, 0.42);
      line-height: 1.6;
    }
    .dark .hint {
      color: rgba(255, 255, 255, 0.42);
    }
    .field {
      display: block;
      margin-bottom: 12px;
    }
    .row > .inp {
      flex: 1 1 auto;
      width: auto;
      min-width: 0;
    }
    .flabel {
      display: block;
      font-size: 11.5px;
      font-weight: 600;
      margin-bottom: 5px;
      opacity: 0.78;
    }
    .fhint {
      display: block;
      font-size: 11px;
      color: rgba(0, 0, 0, 0.42);
      margin-top: 4px;
      line-height: 1.6;
    }
    .dark .fhint {
      color: rgba(255, 255, 255, 0.42);
    }
    .inp {
      width: 100%;
      box-sizing: border-box;
      height: 34px;
      padding: 0 10px;
      font-size: 13px;
      border-radius: 9px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      background: rgba(255, 255, 255, 0.85);
      color: inherit;
      outline: none;
      font-family: inherit;
    }
    .dark .inp {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.12);
    }
    .inp:focus {
      border-color: #18a888;
      box-shadow: 0 0 0 3px rgba(24, 168, 136, 0.14);
    }
    .inp.narrow {
      flex: none;
      width: 92px;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 16px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .row.end {
      justify-content: flex-start;
      margin: 12px 0 10px;
      gap: 10px;
    }
    .unit {
      font-size: 11.5px;
      color: rgba(0, 0, 0, 0.45);
      min-width: 34px;
    }
    .dark .unit {
      color: rgba(255, 255, 255, 0.45);
    }
    button {
      font-family: inherit;
      cursor: pointer;
      border: none;
    }
    .primary {
      height: 32px;
      padding: 0 16px;
      border-radius: 9px;
      background: #18a888;
      color: #fff;
      font-size: 12.5px;
      font-weight: 600;
    }
    .primary:hover {
      background: #14957a;
    }
    .primary:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .primary.big {
      height: 36px;
      padding: 0 26px;
      font-size: 13px;
    }
    .ghost {
      height: 32px;
      padding: 0 12px;
      border-radius: 9px;
      background: transparent;
      border: 1px solid rgba(0, 0, 0, 0.12);
      color: inherit;
      font-size: 12px;
    }
    .dark .ghost {
      border-color: rgba(255, 255, 255, 0.16);
    }
    .ghost.small {
      height: 34px;
      font-size: 11.5px;
      flex: none;
    }
    .msg {
      font-size: 11.5px;
      line-height: 1.5;
    }
    .msg.ok {
      color: #0f9d76;
    }
    .msg.err {
      color: #e11d48;
    }
    .probes {
      margin: 8px 0 10px;
      border: 1px solid rgba(0, 0, 0, 0.07);
      border-radius: 10px;
      overflow: hidden;
    }
    .dark .probes {
      border-color: rgba(255, 255, 255, 0.08);
    }
    .probe {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      font-size: 11.5px;
    }
    .probe + .probe {
      border-top: 1px solid rgba(0, 0, 0, 0.05);
    }
    .dark .probe + .probe {
      border-top-color: rgba(255, 255, 255, 0.06);
    }
    .probe i {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex: none;
      background: #cbd5e1;
    }
    .probe.ok i {
      background: #34d399;
    }
    .probe.no i {
      background: #fb7185;
    }
    .probe em {
      margin-left: auto;
      font-style: normal;
      font-size: 11px;
      opacity: 0.55;
      max-width: 46%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .metrics {
      border: 1px solid rgba(0, 0, 0, 0.07);
      border-radius: 10px;
      padding: 4px 6px;
      margin-bottom: 10px;
    }
    .dark .metrics {
      border-color: rgba(255, 255, 255, 0.08);
    }
    .mrow {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 4px;
    }
    .mcheck {
      display: flex;
      align-items: center;
      gap: 7px;
      flex: 1;
      cursor: pointer;
      font-size: 12px;
    }
    .mc {
      width: 3px;
      height: 13px;
      border-radius: 2px;
      display: inline-block;
    }
    .morder {
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .morder button {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.05);
      color: inherit;
      font-size: 11px;
      line-height: 1;
    }
    .dark .morder button {
      background: rgba(255, 255, 255, 0.08);
    }
    .morder button:disabled {
      opacity: 0.32;
      cursor: default;
    }
    .morder em {
      font-style: normal;
      font-size: 11px;
      width: 16px;
      text-align: center;
      opacity: 0.45;
    }
    .seg {
      display: inline-flex;
      padding: 2px;
      border-radius: 9px;
      background: rgba(0, 0, 0, 0.05);
      gap: 2px;
    }
    .dark .seg {
      background: rgba(255, 255, 255, 0.07);
    }
    .segb {
      height: 26px;
      padding: 0 11px;
      border-radius: 7px;
      background: transparent;
      color: inherit;
      font-size: 11.5px;
      opacity: 0.7;
    }
    .segb.on {
      background: #fff;
      opacity: 1;
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
    }
    .dark .segb.on {
      background: rgba(255, 255, 255, 0.16);
      box-shadow: none;
    }
    .color {
      width: 44px;
      height: 30px;
      padding: 2px;
      border-radius: 8px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      background: transparent;
      cursor: pointer;
    }
    .dark .color {
      border-color: rgba(255, 255, 255, 0.16);
    }
    input[type='range'] {
      width: 120px;
      accent-color: #18a888;
    }
    input[type='checkbox'] {
      accent-color: #18a888;
      width: 13px;
      height: 13px;
    }
    .foot {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 2px 8px;
    }
  `;
}
