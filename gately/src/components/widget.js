import { SunPanelWidgetElement } from '@sun-panel/micro-app';
import { html, svg, css, nothing } from 'lit';
import { buildTheme, resolveConfig, METRICS } from '../utils/theme.js';
import { gateway, emptySnap } from '../utils/gateway.js';
import { setRequestAdapter } from '../utils/api.js';
import { readConfig, readWidgetConfig, serverLabel, CONFIG_EVENT } from '../utils/servers.js';
import { fmtNum, fmtBps, fmtPct, clamp, niceTop } from '../utils/format.js';

const COLOR = Object.fromEntries(METRICS.map((m) => [m.key, m.color]));

/** 卡片放不下完整报错，按错误类型给一句短的 */
const BRIEF = {
  parse: '地址指向了网页',
  proxy: '面板连不上这台',
  auth: '令牌无效',
  scope: '令牌缺少权限',
  network: '连不上',
  notfound: '接口不存在',
  panel: '面板拦截了请求',
  config: '还没配置',
  limit: '请求太频繁',
  server: '网关内部报错',
};


export class GatelyWidget extends SunPanelWidgetElement {
  static properties = {
    snap: { state: true },
    settings: { state: true },
    ready: { state: true },
  };

  constructor() {
    super();
    this.snap = emptySnap();
    this.store = null;
    // 这张卡片盯哪台机器（设置里选的），空则跟随默认
    this.serverId = '';
    this.serverName = '';
    this.settings = null;
    this.ready = false;
    this._unsub = null;
    this._detach = null;
  }

  get cfg() {
    return resolveConfig({ ...(this.settings || {}), ...(this.spCtx?.widgetInfo?.config || {}) });
  }

  get widgetId() {
    return this.spCtx?.widgetInfo?.widgetId || '';
  }

  _bindNetwork() {
    const net = this.spCtx?.api?.network;
    if (net?.request) setRequestAdapter((opts) => net.request(opts));
    gateway.setTimerApi(this.spCtx?.api?.timer);
  }

  onInitialized() {
    this._bindNetwork();
    this._load();
    // 设置页保存后会广播，卡片自己重读一遍绑定关系
    this._onSaved = () => this._load();
    try {
      window.addEventListener(CONFIG_EVENT, this._onSaved);
    } catch {
      /* 非浏览器环境 */
    }
  }

  onWidgetInfoChanged() {
    this._load();
    this.requestUpdate();
  }

  onDisconnected() {
    this._unsub?.();
    this._unsub = null;
    this._detach?.();
    this._detach = null;
    try {
      window.removeEventListener(CONFIG_EVENT, this._onSaved);
    } catch {
      /* ignore */
    }
  }

  /**
   * 读配置 → 绑定到这台服务器 → 订阅它的快照。
   * 每次 widgetInfo 变化都会重跑（卡片设置里改了它看哪台机器）。
   */
  async _load() {
    const dn = this.spCtx?.api?.dataNode?.user;
    try {
      const [conf, mine] = await Promise.all([
        readConfig(dn),
        readWidgetConfig(dn, this.widgetId),
      ]);
      gateway.sync(conf.servers, {
        interval: conf.settings?.refresh,
        defaultId: conf.defaultId,
      });
      if (conf.settings) this.settings = conf.settings;

      const want = String(mine?.serverId || '').trim();
      const store = gateway.get(want);
      const nextId = store?.id || '';
      if (nextId !== this.serverId || store !== this.store) {
        this._unsub?.();
        this._unsub = null;
        this._detach?.();
        this._detach = null;

        this.serverId = nextId;
        this.store = store;
        // 标题优先用用户在设置里起的名字，不拿主机名冒充
        this.serverName = store ? serverLabel(store.server) : '';

        if (store) {
          this._unsub = store.subscribe((snap) => {
            this.snap = snap;
            // 设置里改了名字，下一轮就换过来，不用重开窗口
            this.serverName = serverLabel(store.server);
            this.requestUpdate();
          });
          this._detach = store.attach();
          this.snap = store.snap;
        } else {
          this.snap = emptySnap();
        }
      }
    } catch {
      /* 没存过配置就走空状态 */
    }
    this.ready = true;
    this.requestUpdate();
  }

  // ---------- 行为 ----------
  _openConfig() {
    this.spCtx?.api?.window?.open?.({
      componentName: 'gately-config',
      title: 'Gately 设置',
      customParam: { widgetId: this.widgetId, serverId: this.serverId },
      windowConfig: { width: 760, height: 820, resize: true },
    });
  }

  _openMain() {
    if (!this.store?.configured) {
      this._openConfig();
      return;
    }
    this.spCtx?.api?.window?.open?.({
      componentName: 'gately-main',
      title: this.serverName || this.cfg.title || 'Gately 网关',
      customParam: { serverId: this.serverId },
      windowConfig: { width: 1120, height: 760, resize: true },
    });
  }

  // ---------- 取值 ----------
  _value(key) {
    const s = this.snap;
    const g = s.gateway;
    const guard = s.guard;
    const sites = g?.sites || [];
    switch (key) {
      case 'qps':
        return { v: g ? fmtNum(g.qps) : '—', unit: 'QPS' };
      case 'bw':
        return { v: g ? fmtBps(g.bps) : '—', unit: '' };
      case 'conn':
        return { v: g ? fmtNum(g.active) : '—', unit: '' };
      case 'sites': {
        if (!g) return { v: '—', unit: '' };
        const on = sites.filter((x) => x.enable).length;
        return { v: `${on}/${sites.length}`, unit: '' };
      }
      case 'bans':
        return { v: guard ? fmtNum(guard.bans) : '—', unit: '' };
      case 'blocked':
        return { v: g ? fmtNum(g.blocked) : '—', unit: '' };
      case 'requests':
        return { v: g ? fmtNum(g.requests) : '—', unit: '' };
      case 'cpu':
        return { v: s.phase === 'ok' ? fmtPct(s.cpu) : '—', unit: '' };
      case 'mem':
        return { v: s.phase === 'ok' ? fmtPct(s.memPct) : '—', unit: '' };
      default:
        return { v: '—', unit: '' };
    }
  }

  _title() {
    // 名字最能区分机器：三台都叫 debian 时，主机名帮不上忙。
    // 全局「标题」只在单台时需要（多台会所有卡同名），所以多台时忽略它
    const single = (gateway.servers?.length || 0) <= 1;
    return (single && this.cfg.title) || this.serverName || this.snap.hostname || 'Gately';
  }

  _status() {
    const p = this.snap.phase;
    if (!this.store?.configured) return { cls: 'idle', text: '未配置' };
    if (p === 'error') return { cls: 'err', text: '连接失败' };
    if (p === 'loading' && !this.snap.ts) return { cls: 'idle', text: '连接中' };
    const g = this.snap.gateway;
    if (g && !g.enabled) return { cls: 'warn', text: '网关已停用' };
    if (g && g.unhealthy) return { cls: 'warn', text: `${g.unhealthy} 个后端异常` };
    return { cls: 'ok', text: '运行中' };
  }

  // ---------- 小组件 ----------
  _dot(cls, size = 7) {
    return html`<i class="dot ${cls}" style="width:${size}px;height:${size}px"></i>`;
  }

  /** 指标小块：左边一条颜色，上面小字标签，下面数值 */
  _chip(key, { compact = false } = {}) {
    const meta = METRICS.find((m) => m.key === key);
    if (!meta) return '';
    const { v, unit } = this._value(key);
    return html`
      <div class="chip ${compact ? 'compact' : ''}" style="--c:${COLOR[key]}">
        <span class="cbar"></span>
        <div class="cbody">
          <span class="clabel">${meta.label}</span>
          <span class="cval">${v}${unit ? html`<em>${unit}</em>` : ''}</span>
        </div>
      </div>
    `;
  }

  _chips(keys, opts = {}) {
    return keys.map((k) => this._chip(k, opts));
  }

  /** 趋势曲线：一条实线 + 淡淡的面积，数据来自轮询累积的采样 */
  _spark(mode = 'auto', { showLegend = false, fill = true } = {}) {
    const cfgMode = mode === 'auto' ? this.cfg.trend : mode;
    if (cfgMode === 'none') return '';
    const key = cfgMode === 'qps' ? 'qps' : 'bps';
    const hist = this.snap.hist || [];
    if (hist.length < 2) {
      return html`<div class="spark empty"></div>`;
    }
    const vals = hist.map((h) => Number(h[key]) || 0);
    const max = Math.max(...vals, 1);
    // 从 0 起算，顶部取一个整一点的刻度：流量平稳时就是一条平稳的线，不把噪声放大成山峰
    const top = niceTop(max * 1.15);
    const W = 100;
    const H = 40;
    const n = vals.length;
    const pts = vals.map((v, i) => {
      const x = (i / (n - 1)) * W;
      const y = H - clamp((v / top) * H * 0.9, 0, H);
      return [x, y];
    });
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    const area = `${line} L${W} ${H} L0 ${H} Z`;
    const color = key === 'qps' ? '#34d399' : '#38bdf8';
    const peak = max;
    return html`
      <div class="spark">
        ${svg`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${fill ? svg`<path d=${area} fill=${color} fill-opacity="0.17" />` : nothing}
          <path d=${line} fill="none" stroke=${color} stroke-width="1.4"
            stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        </svg>`}
        ${showLegend
    ? html`<div class="legend">
              <span><i style="background:${color}"></i>${key === 'qps' ? '请求速率' : '实时带宽'}</span>
              <span class="peak">峰值 ${key === 'qps' ? `${fmtNum(peak)} QPS` : fmtBps(peak)}</span>
            </div>`
    : nothing}
      </div>
    `;
  }

  _head({ size = 'md', withStatus = true } = {}) {
    const st = this._status();
    return html`
      <div class="head h-${size}">
        ${this._dot(st.cls, size === 'sm' ? 6 : 7)}
        <span class="name">${this._title()}</span>
        ${withStatus ? html`<span class="state">${st.text}</span>` : ''}
      </div>
    `;
  }

  _empty() {
    return html`
      <div class="empty" @click=${() => this._openConfig()}>
        <span class="etitle">${this.serverName || 'Gately 网关'}</span>
        <span class="ehint">点这里填管理地址与 API 令牌</span>
      </div>
    `;
  }

  _errHint() {
    // 卡片只有巴掌大，长句塞不下也不好懂：给一句短标签，完整原因进 title 和设置页
    const full = String(this.snap.error || '连接失败');
    const brief = BRIEF[this.snap.errorKind] || full.split(/[。；]/)[0].slice(0, 14) || '连接失败';
    return html`<div class="errbar" title=${full} @click=${() => this._openConfig()}>
      ${this.serverName ? html`<span class="ename">${this.serverName}</span>` : nothing}
      <b>${brief}</b>
      <em>点这里改配置</em>
    </div>`;
  }

  // ---------- 各尺寸 ----------
  render1x1() {
    const m = this.cfg.metrics;
    const { v, unit } = this._value(m[0] || 'qps');
    const second = this._value(m[1] || 'bw');
    return html`
      <div class="s1" @click=${() => this._openMain()}>
        <div class="s1top">${this._dot(this._status().cls, 6)}<span class="s1name">${this._title()}</span></div>
        <div class="s1big">${v}<em>${unit}</em></div>
        <div class="s1sub">${second.v}</div>
        <div class="s1spark">${this._spark('auto', { fill: false })}</div>
      </div>
    `;
  }

  render1x2() {
    const m = this.cfg.metrics;
    return html`
      <div class="col" @click=${() => this._openMain()}>
        ${this._head({ size: 'sm' })}
        <div class="chips">${this._chips(m.slice(0, 2))}</div>
        ${this._spark('auto')}
        <div class="minilist">
          ${m.slice(2, 4).map((k) => {
    const meta = METRICS.find((x) => x.key === k);
    const { v, unit } = this._value(k);
    return html`<div class="minirow">
              <i style="background:${meta?.color || 'currentColor'}" class="mk"></i>
              <span class="mn">${meta?.label || k}</span>
              <span class="mv">${v}${unit}</span>
            </div>`;
  })}
        </div>
      </div>
    `;
  }

  render2x1() {
    const m = this.cfg.metrics;
    return html`
      <div class="col tight" @click=${() => this._openMain()}>
        ${this._head({ size: 'sm' })}
        <div class="chips row">${this._chips(m.slice(0, 2), { compact: true })}</div>
      </div>
    `;
  }

  render2x2() {
    const m = this.cfg.metrics;
    return html`
      <div class="col" @click=${() => this._openMain()}>
        ${this._head({ size: 'md' })}
        <div class="chips quad">${this._chips(m.slice(0, 4))}</div>
        ${this._spark('auto')}
      </div>
    `;
  }

  render2x4() {
    const m = this.cfg.metrics;
    return html`
      <div class="col wide" @click=${() => this._openMain()}>
        ${this._head({ size: 'md' })}
        <div class="split">
          <div class="chips quad left">${this._chips(m.slice(0, 4))}</div>
          <div class="chart">${this._spark('auto', { showLegend: true })}</div>
        </div>
      </div>
    `;
  }

  render4x4() {
    const m = this.cfg.metrics;
    const g = this.snap.gateway;
    const sites = (g?.sites || []).slice(0, 3);
    return html`
      <div class="col" @click=${() => this._openMain()}>
        ${this._head({ size: 'lg' })}
        <div class="chips grid6">${this._chips(m.slice(0, 6))}</div>
        ${this._spark('auto', { showLegend: true })}
        ${sites.length
    ? html`<div class="minilist">
              ${sites.map(
    (s) => html`<div class="minirow">
                  <i class="dot ${s.running && s.enable ? 'ok' : 'idle'}" style="width:5px;height:5px"></i>
                  <span class="mn">${s.name}</span>
                  <span class="mv">${fmtNum(s.rate.qps)} QPS</span>
                </div>`,
  )}
            </div>`
    : ''}
      </div>
    `;
  }

  render1xfull() {
    const m = this.cfg.metrics;
    return html`
      <div class="row" @click=${() => this._openMain()}>
        <div class="rowhead">
          ${this._dot(this._status().cls, 7)}
          <div class="rowtitle">
            <span class="name">${this._title()}</span>
            <span class="state">${this._status().text}</span>
          </div>
        </div>
        <div class="chips row grow">${this._chips(m.slice(0, 6), { compact: true })}</div>
        <div class="chart rowchart">${this._spark('auto')}</div>
      </div>
    `;
  }

  render() {
    const size = this.spCtx?.widgetInfo?.gridSize || '1x1';
    const theme = buildTheme(this.cfg, this.spCtx?.darkMode);
    const isTransparent = theme.cfg.bgMode === 'transparent';

    const style = [
      theme.surface,
      `color:${theme.text}`,
      `border-radius:${theme.radius}px`,
      `border:${theme.border}`,
      `box-shadow:${isTransparent ? 'none' : theme.shadow}`,
      `text-shadow:${isTransparent ? theme.textShadow : 'none'}`,
      `--soft:${theme.sub}`,
      `--faint:${theme.faint}`,
      `--accent:${theme.accent}`,
      `--hairline:${theme.hairline}`,
      `--chipbg:${theme.chipBg()}`,
    ].join(';');

    let body;
    if (!this.ready) {
      body = html`<div class="empty"><span class="etitle">载入中…</span></div>`;
    } else if (!this.store?.configured) {
      body = this._empty();
    } else if (this.snap.phase === 'error' && !this.snap.ts) {
      body = this._errHint();
    } else {
      const render = {
        '1x1': () => this.render1x1(),
        '1x2': () => this.render1x2(),
        '2x1': () => this.render2x1(),
        '2x2': () => this.render2x2(),
        '2x4': () => this.render2x4(),
        '4x4': () => this.render4x4(),
        '1xfull': () => this.render1xfull(),
      }[size];
      body = render ? render() : this.render1x1();
    }

    return html`<div class="container size-${size}" style="${style}">${body}</div>`;
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
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      background-color: transparent;
      -webkit-font-smoothing: antialiased;
      cursor: pointer;
      container-type: size;
    }
    .size-1x1 {
      padding: 8px 9px;
    }
    .size-1xfull {
      padding: 8px 14px;
    }
    .size-2x1 {
      padding: 8px 11px;
    }
    .size-2x1 .chip {
      min-height: 0;
    }
    /* 2x1 只有两块，让它们把 116 的高度吃满，别挤在上半截 */
    .size-2x1 .chips {
      flex: 1 1 auto;
      min-height: 0;
    }
    .size-1x2 .chip {
      min-height: 32px;
      padding: 4px 7px;
    }
    .size-1x2 .spark {
      min-height: 40px;
      /* 曲线吃掉剩余高度，底部就不会空一截 */
      flex: 1 1 auto;
    }
    .size-1x2 .minilist {
      flex: none;
      margin-top: auto;
    }
    .size-4x4 .spark {
      min-height: 150px;
    }

    .dot {
      display: inline-block;
      border-radius: 50%;
      flex: none;
    }
    .dot.ok {
      background: #34d399;
      box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.22);
    }
    .dot.err {
      background: #f87171;
      box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.22);
    }
    .dot.warn {
      background: #fbbf24;
      box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.22);
    }
    .dot.idle {
      background: var(--faint);
    }

    .head {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      margin-bottom: 7px;
    }
    .head .name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .h-sm .name {
      font-size: 12px;
    }
    .h-md .name {
      font-size: 13px;
    }
    .h-lg .name {
      font-size: 15px;
    }
    .head .state {
      margin-left: auto;
      font-size: 10.5px;
      color: var(--soft);
      white-space: nowrap;
      flex: none;
    }

    .col {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-width: 0;
      gap: 6px;
    }
    .col.tight {
      gap: 5px;
      justify-content: center;
    }

    .chips {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-auto-rows: minmax(0, auto);
      gap: 6px;
      min-width: 0;
      flex: none;
    }
    .chips.row {
      display: flex;
      gap: 6px;
    }
    .chips.row > .chip {
      flex: 1 1 0;
      min-width: 0;
    }
    .chips.quad {
      grid-auto-rows: minmax(0, auto);
    }
    .chips.grid6 {
      grid-template-columns: repeat(3, 1fr);
    }

    .chip {
      display: flex;
      align-items: stretch;
      gap: 7px;
      min-width: 0;
      min-height: 40px;
      padding: 5px 8px;
      border-radius: 9px;
      background: var(--chipbg);
      border: 1px solid var(--hairline);
      box-sizing: border-box;
      overflow: hidden;
    }
    .chip.compact {
      min-height: 32px;
      padding: 4px 7px;
      gap: 6px;
      border-radius: 8px;
    }
    .cbar {
      flex: none;
      width: 3px;
      border-radius: 2px;
      background: var(--c);
    }
    .cbody {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
      justify-content: center;
    }
    .clabel {
      font-size: 9.5px;
      line-height: 1.15;
      color: var(--soft);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: 0.1px;
    }
    .compact .clabel {
      font-size: 9px;
    }
    .cval {
      font-size: 14px;
      line-height: 1.2;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .compact .cval {
      font-size: 12.5px;
    }
    .cval em {
      font-style: normal;
      font-size: 9px;
      font-weight: 500;
      color: var(--soft);
      margin-left: 2px;
    }

    .spark {
      position: relative;
      width: 100%;
      min-width: 0;
      min-height: 14px;
      flex: 1 1 auto;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      gap: 3px;
    }
    .spark.empty {
      opacity: 0.35;
    }
    .spark svg {
      width: 100%;
      height: 100%;
      display: block;
      overflow: visible;
      grid-row: 1;
    }
    .legend {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 9.5px;
      color: var(--soft);
      white-space: nowrap;
    }
    .legend i {
      display: inline-block;
      width: 8px;
      height: 2px;
      border-radius: 1px;
      margin-right: 4px;
      vertical-align: middle;
    }
    .legend .peak {
      margin-left: auto;
      color: var(--faint);
    }

    /* 1x1 */
    .s1 {
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 0;
    }
    .s1top {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    .s1name {
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .s1big {
      margin-top: 2px;
      font-size: 22px;
      line-height: 1.05;
      font-weight: 680;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .s1big em {
      font-style: normal;
      font-size: 9.5px;
      font-weight: 500;
      color: var(--soft);
      margin-left: 3px;
    }
    .s1spark {
      height: 18px;
      margin-top: 4px;
      display: flex;
    }
    .s1spark .spark {
      flex: 1;
    }
    .s1sub {
      font-size: 10px;
      color: var(--soft);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 1px;
    }

    /* 2x4：左边指标，右边曲线 */
    .split {
      display: flex;
      gap: 10px;
      flex: 1;
      min-height: 0;
    }
    .split .left {
      flex: none;
      width: 58%;
    }
    .split .chart {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: stretch;
    }
    .split .chart .spark {
      height: 100%;
    }

    /* 1xfull：一行通栏 */
    .row {
      display: flex;
      align-items: stretch;
      gap: 12px;
      width: 100%;
      min-width: 0;
    }
    .rowhead {
      display: flex;
      align-items: center;
      gap: 7px;
      flex: none;
      max-width: 22%;
    }
    .rowtitle {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .rowtitle .name {
      font-size: 13px;
      font-weight: 650;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rowtitle .state {
      font-size: 9.5px;
      color: var(--soft);
      white-space: nowrap;
    }
    .row .chips {
      flex: 1 1 auto;
      align-items: center;
    }
    .rowchart {
      flex: none;
      width: 22%;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    /* 站点小列表 */
    .minilist {
      display: flex;
      flex-direction: column;
      gap: 3px;
      border-top: 1px solid var(--hairline);
      padding-top: 6px;
    }
    .minirow {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10.5px;
      min-width: 0;
    }
    .minirow .mk {
      width: 3px;
      height: 9px;
      border-radius: 2px;
      flex: none;
    }
    .minirow .mn {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--soft);
    }
    .minirow .mv {
      flex: none;
      font-variant-numeric: tabular-nums;
      color: var(--faint);
    }

    /* 空 / 错误 */
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      width: 100%;
      text-align: center;
      padding: 0 4px;
    }
    .etitle {
      font-size: 12.5px;
      font-weight: 600;
    }
    .ehint {
      font-size: 10.5px;
      color: var(--soft);
      line-height: 1.35;
    }
    .errbar {
      width: 100%;
      font-size: 10.5px;
      line-height: 1.4;
      color: #f87171;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      overflow: hidden;
    }
    .errbar b {
      font-weight: 600;
      font-size: 11px;
    }
    .errbar .ename {
      max-width: 100%;
      font-size: 9.5px;
      color: var(--soft);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .errbar em {
      font-style: normal;
      font-size: 9.5px;
      opacity: 0.6;
      color: var(--soft);
    }

    /* 窄卡片（1x1 / 1x2）放不下一行两个指标块 */
    @container (max-width: 152px) {
      .chips {
        grid-template-columns: 1fr;
      }
      .head .state {
        display: none;
      }
      .h-sm .name {
        font-size: 11.5px;
      }
      .chip {
        min-height: 34px;
      }
      .clabel {
        font-size: 9px;
      }
      .cval {
        font-size: 13px;
      }
    }
    @container (max-width: 130px) {
      .chips.row {
        flex-direction: column;
      }
    }
  `;
}
