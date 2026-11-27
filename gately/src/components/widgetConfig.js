import { SunPanelPageElement } from '@sun-panel/micro-app';
import { html, css } from 'lit';
import { resolveConfig, METRICS, DEFAULT_CONFIG } from '../utils/theme.js';
import { gateway } from '../utils/gateway.js';
import { setRequestAdapter, createClient, normalizeHost, hostOf, probe } from '../utils/api.js';
import {
  readConfig, writeServers, writeWidgetConfig, normalizeServers, newId, serverLabel, emitConfigSaved,
  KEY_SETTINGS, NODE,
} from '../utils/servers.js';

const PROBES = [
  { key: 'status', label: '系统状态 status:read', run: (c) => c.status() },
  { key: 'web', label: '站点与拓扑 webservice:read', run: (c) => c.topology() },
  { key: 'guard', label: '封禁与防护 guard:read', run: (c) => c.guardStatus() },
  { key: 'ssl', label: '证书 ssl:read', run: (c) => c.certs() },
  { key: 'ddns', label: '动态域名 ddns:read', run: (c) => c.ddns() },
  { key: 'logs', label: '系统日志 logs:read', run: (c) => c.logs(1) },
];

const MAX_SERVERS = 8;

export class GatelyConfig extends SunPanelPageElement {
  static properties = {
    servers: { state: true },
    widgetId: { state: true },
    cardServerId: { state: true },
    defaultServerId: { state: true },
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
    message: { state: true },
    msgKind: { state: true },
    dark: { state: true },
    migrated: { state: true },
    tests: { state: true },
    tokenOpen: { state: true },
    pendingDel: { state: true },
    diag: { state: true },
  };

  constructor() {
    super();
    this.servers = [];
    // 每台的测试状态：id -> { busy, ok, text, probes }
    this.tests = {};
    // 令牌明文显示的 id 集合
    this.tokenOpen = {};
    this.widgetId = '';
    this.cardServerId = '';
    this.defaultServerId = '';
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
    this.message = '';
    this.msgKind = '';
    this.dark = false;
    this.migrated = false;
    this.pendingDel = '';
    this.diag = null;
  }

  _bindNetwork() {
    const net = this.spCtx?.api?.network;
    if (net?.request) setRequestAdapter((opts) => net.request(opts));
  }

  async onInitialized(param) {
    this._bindNetwork();
    this.dark = !!this.spCtx?.darkMode;
    // 从某张卡片点「设置」进来时，带上它是哪一张、当前看哪台
    const cp = param?.customParam || {};
    this.widgetId = String(cp.widgetId || param?.widgetInfo?.widgetId || '');
    this.cardServerId = String(cp.serverId || '');

    const dn = this.spCtx?.api?.dataNode?.user;
    try {
      const conf = await readConfig(dn);
      this.servers = conf.servers.length ? conf.servers.map((s) => ({ ...s })) : [];
      this.migrated = conf.migrated;
      this.defaultServerId = conf.defaultId;
      if (conf.settings) {
        const c = resolveConfig(conf.settings);
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
      if (this.widgetId) {
        const mine = await dn?.getByKey?.(NODE, `widget:${this.widgetId}`);
        if (mine?.serverId) this.cardServerId = String(mine.serverId);
      }
    } catch {
      /* 首次使用，用默认值 */
    }
  }

  // ---------- 服务器清单 ----------
  _addServer() {
    if (this.servers.length >= MAX_SERVERS) {
      this._say(`最多添加 ${MAX_SERVERS} 台，够用了`, 'err');
      return;
    }
    const s = { id: newId(), name: '', host: '', token: '' };
    this.servers = [...this.servers, s];
    if (!this.defaultServerId) this.defaultServerId = s.id;
    if (!this.cardServerId) this.cardServerId = s.id;
    // 新行聚焦到地址输入
    this.updateComplete.then(() => {
      const el = this.renderRoot?.querySelector?.(`[data-host="${s.id}"]`);
      el?.focus?.();
    });
  }

  /**
   * 删除一台。
   * 面板窗口里 confirm() 常被拦掉，点了像没反应，所以改成行内二次确认：
   * 第一次点变成「确认移除」，再点才真删，3 秒不点自动收回。
   */
  _removeServer(id) {
    if (this.pendingDel === id) {
      this.pendingDel = '';
      this.servers = this.servers.filter((x) => x.id !== id);
      delete this.tests[id];
      this.tests = { ...this.tests };
      if (this.defaultServerId === id) this.defaultServerId = this.servers[0]?.id || '';
      if (this.cardServerId === id) this.cardServerId = '';
      this._say('已从清单移除，点保存后生效', 'ok');
      return;
    }
    this.pendingDel = id;
    if (this._delTimer) clearTimeout(this._delTimer);
    this._delTimer = setTimeout(() => {
      this.pendingDel = '';
    }, 3000);
  }

  _patch(id, patch) {
    this.servers = this.servers.map((s) => (s.id === id ? { ...s, ...patch } : s));
  }

  _toggleToken(id) {
    this.tokenOpen = { ...this.tokenOpen, [id]: !this.tokenOpen[id] };
  }

  _defaultLabel(s) {
    return String(s.name || '').trim() || hostOf(s.host) || '新服务器';
  }

  // ---------- 测试连接 ----------
  async _test(server) {
    const host = normalizeHost(server.host);
    const id = server.id;
    const set = (patch) => {
      this.tests = { ...this.tests, [id]: { ...(this.tests[id] || {}), ...patch } };
    };
    if (!host) {
      set({ busy: false, ok: false, text: '先填管理地址', probes: [] });
      return;
    }
    if (!String(server.token || '').trim()) {
      set({ busy: false, ok: false, text: '先填 API 令牌', probes: [] });
      return;
    }
    set({ busy: true, ok: null, text: '正在连接…', probes: [] });
    const client = createClient({ host, token: server.token });
    let status;
    try {
      status = await client.status();
    } catch (e) {
      set({ busy: false, ok: false, text: e?.message || '连接失败', probes: [] });
      return;
    }
    const hostname = status?.host?.hostname || '';
    set({
      busy: false,
      ok: true,
      text: `连接成功：${status?.version || '未知版本'}${hostname ? ` · 主机名 ${hostname}` : ''}`,
      probes: [{ key: 'status', label: PROBES[0].label, ok: true, note: status?.version || '' }],
    });
    for (const p of PROBES.slice(1)) {
      const cur = this.tests[id];
      try {
        await p.run(client);
        set({ probes: [...(cur?.probes || []), { key: p.key, label: p.label, ok: true }] });
      } catch (e) {
        set({
          probes: [...(cur?.probes || []), { key: p.key, label: p.label, ok: false, note: e?.message || '失败' }],
        });
      }
    }
  }

  /**
   * 诊断：原样打一次 /api/status，把实际 URL、状态码、类型和响应开头摊开。
   * 「连上了但数据不对」的时候，这一屏比任何猜测都管用。
   */
  async _diag(s) {
    const base = normalizeHost(s.host);
    if (!base) {
      this._say('先填管理地址', 'err');
      return;
    }
    const url = `${base}/api/status`;
    this.diag = { id: s.id, url, status: 0, ctype: '', snippet: '', error: '请求中…', verdict: '' };
    const r = await probe(url, String(s.token || '').trim());
    // 给人一句结论：这是 Gately 的接口、还是落到了网页、还是别的东西
    // 用完整正文判断（status 的 version 在 JSON 末尾，截断会漏）
    const full = r.body || r.snippet || '';
    let verdict = 'other';
    if (/sun_?pan\w*_template_proxy_error|"code"\s*:\s*-1/.test(full)) verdict = 'proxy';
    else if (/^<!doctype html|<html/i.test(full)) verdict = 'html';
    else if (/"version"\s*:|"hostname"\s*:/.test(full)) verdict = 'gately';
    delete r.body;
    this.diag = { id: s.id, url, ...r, verdict };
  }

  _say(text, kind = 'ok') {
    this.message = text;
    this.msgKind = kind;
  }

  // ---------- 保存 ----------
  async _save() {
    // 填了名字或令牌却没填地址的行，别静默丢掉
    const noHost = this.servers.find(
      (s) => !normalizeHost(s.host) && (String(s.name || '').trim() || String(s.token || '').trim()),
    );
    if (noHost) {
      this._say(
        `「${String(noHost.name || '').trim() || '有一台'}」还没填管理地址，比如 http://192.168.1.10:16680`,
        'err',
      );
      return;
    }
    const list = normalizeServers(
      this.servers.map((s) => ({
        ...s,
        name: String(s.name || '').trim() || hostOf(s.host),
      })),
    );
    // 两台填了同一个地址会被合并，得说清楚，否则用户以为少了一台
    const merged = this.servers.filter((s) => normalizeHost(s.host)).length - list.length;
    if (!list.length) {
      this._say('至少填一台 Gately 的地址与令牌', 'err');
      return;
    }
    const missing = list.find((s) => !s.token);
    if (missing) {
      this._say(`「${serverLabel(missing)}」还没填 API 令牌`, 'err');
      return;
    }
    const defaultId = list.some((s) => s.id === this.defaultServerId) ? this.defaultServerId : list[0].id;
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
      defaultServerId: defaultId,
    };
    try {
      const dn = this.spCtx?.api?.dataNode?.user;
      await writeServers(dn, list);
      await dn?.setByKey?.(NODE, KEY_SETTINGS, settings);
      if (this.widgetId) {
        // 卡片绑的那台被删了就退回「跟随默认」，别留一个指向空气的 id
        const cardId = list.some((s) => s.id === this.cardServerId) ? String(this.cardServerId) : '';
        await writeWidgetConfig(dn, this.widgetId, { serverId: cardId });
        this.cardServerId = cardId;
      }
      // 立刻反映到卡片，不用等下次打开
      gateway.sync(list, { interval: settings.refresh, defaultId });
      this.servers = list.map((s) => ({ ...s }));
      this.defaultServerId = defaultId;
      this.migrated = false;
      emitConfigSaved({ widgetId: this.widgetId });
      this._say(
        merged > 0
          ? `已保存 ${list.length} 台（${merged} 台地址重复，已合并）`
          : `已保存 ${list.length} 台，卡片会立刻按新配置刷新`,
        'ok',
      );
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

  /** 一台服务器的编辑块 */
  _serverRow(s, idx) {
    const t = this.tests[s.id];
    const open = !!this.tokenOpen[s.id];
    const isDefault = this.defaultServerId === s.id;
    return html`
      <div class="srv">
        <div class="srv-head">
          <span class="srv-no">${idx + 1}</span>
          <input
            class="inp name"
            .value=${s.name}
            placeholder=${hostOf(s.host) || '给这台起个名字，如「家里 NAS」'}
            @input=${(e) => this._patch(s.id, { name: e.target.value })}
          />
          <button
            class="ghost small ${isDefault ? 'on' : ''}"
            title="主窗口默认打开这台"
            @click=${() => {
    this.defaultServerId = s.id;
    this._say(`默认打开「${this._defaultLabel(s)}」`, 'ok');
  }}
          >
            ${isDefault ? '默认' : '设为默认'}
          </button>
          <button
            class="ghost small ${this.pendingDel === s.id ? 'danger' : ''}"
            @click=${() => this._removeServer(s.id)}
          >
            ${this.pendingDel === s.id ? '确认移除' : '移除'}
          </button>
        </div>
        <div class="srv-line">
          <input
            class="inp"
            data-host=${s.id}
            .value=${s.host}
            placeholder="http://192.168.1.10:16680"
            @input=${(e) => this._patch(s.id, { host: e.target.value })}
          />
        </div>
        <div class="srv-line">
          <input
            class="inp"
            type=${open ? 'text' : 'password'}
            .value=${s.token}
            placeholder="gtl_xxxxxxxx"
            @input=${(e) => this._patch(s.id, { token: e.target.value })}
          />
          <button class="ghost small" @click=${() => this._toggleToken(s.id)}>${open ? '隐藏' : '显示'}</button>
          <button class="ghost small" @click=${() => this._diag(s)}>诊断</button>
          <button class="ghost small" @click=${() => this._test(s)} ?disabled=${t?.busy}>
            ${t?.busy ? '测试中…' : '测试'}
          </button>
        </div>
        ${this.diag?.id === s.id
    ? html`<div class="diagbox">
              <div class="dline"><span class="dk">实际请求</span><code>${this.diag.url}</code></div>
              <div class="dline">
                <span class="dk">响应</span>
                <b class="dstatus ${this.diag.status >= 200 && this.diag.status < 300 ? 'warn' : 'good'}">
                  ${this.diag.status || '无响应'}
                </b>
                <span class="dct">${this.diag.ctype || '未知类型'}</span>
                <span class="dverdict ${this.diag.verdict === 'gately' ? 'good' : 'warn'}">
                  ${this.diag.verdict === 'gately' ? '· 接口正常'
    : this.diag.verdict === 'html' ? '· 返回的是网页'
      : this.diag.verdict === 'proxy' ? '· 面板代理失败'
        : this.diag.verdict ? '· 内容不是 Gately' : ''}
                </span>
              </div>
              ${this.diag.snippet ? html`<pre class="dbody">${this.diag.snippet}</pre>` : ''}
              ${this.diag.error ? html`<div class="derr">${this.diag.error}</div>` : ''}
            </div>`
    : ''}
        ${t
    ? html`<div class="tres ${t.ok === true ? 'ok' : t.ok === false ? 'no' : 'wait'}">
              <i></i><span>${t.text}</span>
              ${t.probes?.length > 1
    ? html`<em>权限 ${t.probes.filter((p) => p.ok).length}/${PROBES.length}</em>`
    : ''}
            </div>
            ${t.probes?.length
    ? html`<div class="probes">
                  ${t.probes.map(
    (p) => html`<div class="probe ${p.ok ? 'ok' : 'no'}">
                      <i></i><span>${p.label}</span>
                      <em>${p.ok ? '可用' : p.note || '无权限'}</em>
                    </div>`,
  )}
                </div>`
    : ''}`
    : ''}
      </div>
    `;
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

    const cardOptions = this.servers.map((s) => ({
      id: s.id,
      label: this._defaultLabel(s),
    }));

    return html`
      <div class="wrap ${this.dark ? 'dark' : ''}">
        <div class="head">
          <div>
            <h1>Gately 设置</h1>
            <p>
              可以加多台 Gately，每张卡片各盯一台。令牌在 Gately 后台「设置 → API 令牌」页创建，勾选
              <code>status:read</code>、<code>webservice:read</code>、<code>guard:read</code> 等读权限；
              要启停站点、封禁 IP 还需要对应的 <code>:write</code>。
            </p>
          </div>
          <button class="ghost" @click=${() => this._reset()}>复位外观</button>
        </div>

        ${this.migrated
    ? html`<div class="note">已从旧版单台配置迁移过来，名字先用了主机名，可以改成更好认的叫法。</div>`
    : ''}

        <div class="card">
          <div class="card-head">
            <h2>服务器</h2>
            <span class="hint">名字随你起，卡片和窗口标题都显示它，不会再是 debian 这种主机名</span>
          </div>
          ${this.servers.length
    ? this.servers.map((s, i) => this._serverRow(s, i))
    : html`<div class="blank">还没有服务器。点下面的「添加服务器」，填上 Gately 的管理地址和令牌。</div>`}
          <div class="row end">
            <button class="ghost" @click=${() => this._addServer()} ?disabled=${this.servers.length >= MAX_SERVERS}>
              ＋ 添加服务器
            </button>
            <span class="hint">${this.servers.length}/${MAX_SERVERS} 台</span>
          </div>
        </div>

        ${this.widgetId && cardOptions.length > 1
    ? html`<div class="card">
            <div class="card-head">
              <h2>这张卡片</h2>
              <span class="hint">导航页上这一张盯哪台；其它卡片各选各的，互不影响</span>
            </div>
            ${this._field(
    '显示哪台服务器',
    html`<select
                class="inp"
                .value=${this.cardServerId}
                @change=${(e) => (this.cardServerId = e.target.value)}
              >
                <option value="" ?selected=${!this.cardServerId}>
                  跟随默认（${this._defaultLabel(this.servers.find((s) => s.id === this.defaultServerId) || {})}）
                </option>
                ${cardOptions.map(
    (o) => html`<option value=${o.id} ?selected=${o.id === this.cardServerId}>${o.label}</option>`,
  )}
              </select>`,
    '同一台机器摆两张卡也可以，比如一张只看 CPU、一张只看请求',
  )}
          </div>`
    : ''}

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
              placeholder="留空则用服务器名字"
              @input=${(e) => (this.title = e.target.value)}
            />`,
    '只在单台时生效；加了多台就各自显示服务器名字，否则所有卡片会同名',
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
    '每台都按这个间隔取状态，最短 5 秒。页面切到后台时不会继续请求',
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
          <span class="hint ${this.msgKind}">${this.message || '保存后卡片与主窗口都会用新配置'}</span>
        </div>
      </div>
    `;
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
    .note {
      margin-bottom: 12px;
      padding: 9px 12px;
      border-radius: 10px;
      font-size: 11.5px;
      line-height: 1.6;
      background: rgba(24, 168, 136, 0.1);
      color: #0d7a64;
      border: 1px solid rgba(24, 168, 136, 0.18);
    }
    .dark .note {
      background: rgba(52, 211, 153, 0.1);
      color: #6ee7b7;
      border-color: rgba(52, 211, 153, 0.2);
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
    .hint.err {
      color: #e11d48;
    }
    .hint.ok {
      color: #0f9d76;
    }
    .blank {
      padding: 18px 12px;
      text-align: center;
      font-size: 12px;
      color: rgba(0, 0, 0, 0.45);
      border: 1px dashed rgba(0, 0, 0, 0.12);
      border-radius: 10px;
      margin-bottom: 10px;
    }
    .dark .blank {
      color: rgba(255, 255, 255, 0.45);
      border-color: rgba(255, 255, 255, 0.14);
    }

    /* 服务器行 */
    .srv {
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 11px;
      padding: 9px 10px 10px;
      margin-bottom: 9px;
      background: rgba(255, 255, 255, 0.6);
    }
    .dark .srv {
      border-color: rgba(255, 255, 255, 0.09);
      background: rgba(255, 255, 255, 0.035);
    }
    .srv-head {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 7px;
    }
    .srv-no {
      width: 17px;
      height: 17px;
      border-radius: 50%;
      flex: none;
      font-size: 10.5px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(24, 168, 136, 0.14);
      color: #0d7a64;
      font-weight: 600;
    }
    .dark .srv-no {
      background: rgba(52, 211, 153, 0.16);
      color: #6ee7b7;
    }
    .srv-head .name {
      flex: 1 1 auto;
      width: auto;
      min-width: 0;
      font-weight: 600;
    }
    .srv-line {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 6px;
    }
    .srv-line:last-child {
      margin-bottom: 0;
    }
    .icon {
      flex: none;
      width: 26px;
      height: 26px;
      border-radius: 7px;
      background: transparent;
      color: inherit;
      opacity: 0.4;
      font-size: 12px;
      line-height: 1;
    }
    .icon.del:hover {
      opacity: 1;
      color: #e11d48;
      background: rgba(225, 29, 72, 0.1);
    }
    .tres {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 7px;
      font-size: 11px;
      line-height: 1.5;
    }
    .tres i {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex: none;
      background: #cbd5e1;
    }
    .tres.ok {
      color: #0f9d76;
    }
    .tres.ok i {
      background: #34d399;
    }
    .tres.no {
      color: #e11d48;
    }
    .tres.no i {
      background: #fb7185;
    }
    .tres em {
      margin-left: auto;
      font-style: normal;
      opacity: 0.6;
      flex: none;
    }

    /* 诊断面板：把原始响应摊开来 */
    .diagbox {
      margin-top: 7px;
      padding: 8px 10px;
      border-radius: 9px;
      background: rgba(15, 23, 42, 0.045);
      border: 1px solid rgba(15, 23, 42, 0.09);
      font-size: 11px;
      line-height: 1.6;
    }
    .dark .diagbox {
      background: rgba(255, 255, 255, 0.045);
      border-color: rgba(255, 255, 255, 0.09);
    }
    .dline {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 3px;
      flex-wrap: wrap;
    }
    .dk {
      flex: none;
      font-size: 10.5px;
      opacity: 0.55;
    }
    .dline code {
      font-size: 10.5px;
      word-break: break-all;
      opacity: 0.9;
    }
    .dstatus {
      font-weight: 700;
      font-size: 12px;
    }
    .dstatus.warn {
      color: #e11d48;
    }
    .dstatus.good {
      color: #0f9d76;
    }
    .dct {
      font-size: 10.5px;
      opacity: 0.6;
    }
    .dverdict {
      font-size: 10.5px;
      font-weight: 600;
    }
    .dverdict.good {
      color: #0f9d76;
    }
    .dverdict.warn {
      color: #e11d48;
    }
    .dbody {
      margin: 5px 0 0;
      padding: 6px 8px;
      border-radius: 6px;
      background: rgba(15, 23, 42, 0.06);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 96px;
      overflow: auto;
    }
    .dark .dbody {
      background: rgba(255, 255, 255, 0.06);
    }
    .derr {
      margin-top: 4px;
      font-size: 10.5px;
      color: #e11d48;
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
    select.inp {
      padding-right: 6px;
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
      margin: 10px 0 2px;
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
    .ghost:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .ghost.small {
      height: 34px;
      font-size: 11.5px;
      flex: none;
      padding: 0 10px;
    }
    .ghost.on {
      border-color: rgba(24, 168, 136, 0.5);
      color: #0d7a64;
      background: rgba(24, 168, 136, 0.1);
    }
    .dark .ghost.on {
      color: #6ee7b7;
      background: rgba(52, 211, 153, 0.14);
    }
    .ghost.danger {
      border-color: rgba(225, 29, 72, 0.55);
      color: #e11d48;
      background: rgba(225, 29, 72, 0.1);
      font-weight: 600;
    }
    .dark .ghost.danger {
      border-color: rgba(251, 113, 133, 0.6);
      color: #fda4af;
      background: rgba(251, 113, 133, 0.14);
    }
    .probes {
      margin-top: 6px;
      border: 1px solid rgba(0, 0, 0, 0.07);
      border-radius: 9px;
      overflow: hidden;
    }
    .dark .probes {
      border-color: rgba(255, 255, 255, 0.08);
    }
    .probe {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 9px;
      font-size: 11px;
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
      font-size: 10.5px;
      opacity: 0.55;
      max-width: 52%;
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
