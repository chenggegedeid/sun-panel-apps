import { SunPanelPageElement } from '@sun-panel/micro-app';
import { html, svg, css, nothing } from 'lit';
import { gateway } from '../utils/gateway.js';
import { setRequestAdapter, normalizeHost, hostOf } from '../utils/api.js';
import {
  fmtNum, fmtBytes, fmtBps, fmtDuration, fmtAgo, fmtClock, fmtDateTime, fmtPct, daysLeft, clamp, niceTop,
} from '../utils/format.js';

const TABS = [
  { id: 'overview', t: '概览' },
  { id: 'sites', t: '站点' },
  { id: 'certs', t: '证书' },
  { id: 'bans', t: '封禁' },
  { id: 'logs', t: '日志' },
];

/** 官方图标（G 形圆弧 + 右上亮点），卡片和窗口头部共用 */
function logo(size = 26) {
  return html`<svg width=${size} height=${size} viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id="gl-${size}" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#18a888" />
        <stop offset="1" stop-color="#0b5f4f" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#gl-${size})" />
    <path d="M21.7 10.3A8 8 0 1 0 24 16h-7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="23.6" cy="8.6" r="2.2" fill="#9ff3dc" />
  </svg>`;
}

export class GatelyMain extends SunPanelPageElement {
  static properties = {
    snap: { state: true },
    tab: { state: true },
    stats: { state: true },
    certs: { state: true },
    bans: { state: true },
    ddns: { state: true },
    logs: { state: true },
    procs: { state: true },
    errs: { state: true },
    busy: { state: true },
    range: { state: true },
    msg: { state: true },
    banIp: { state: true },
    banSec: { state: true },
    banReason: { state: true },
    ready: { state: true },
  };

  constructor() {
    super();
    this.snap = gateway.snap;
    this.tab = 'overview';
    this.stats = null;
    this.certs = null;
    this.bans = null;
    this.ddns = null;
    this.logs = null;
    this.procs = null;
    this.errs = {};
    this.busy = {};
    this.range = 30;
    this.msg = null;
    this.banIp = '';
    this.banSec = '0';
    this.banReason = '';
    this.ready = false;
    this._unsub = null;
    this._detach = null;
  }

  get base() {
    return normalizeHost(gateway.conn?.host || '');
  }

  async onInitialized() {
    const net = this.spCtx?.api?.network;
    if (net?.request) setRequestAdapter((opts) => net.request(opts));
    gateway.setTimerApi(this.spCtx?.api?.timer);

    try {
      const dn = this.spCtx?.api?.dataNode?.user;
      const [conn, settings] = await Promise.all([
        dn?.getByKey('gately', 'conn'),
        dn?.getByKey('gately', 'settings'),
      ]);
      if (conn) {
        gateway.configure({ host: conn.host, token: conn.token, interval: settings?.refresh ?? conn.interval });
      }
    } catch {
      /* 没配置时下面会显示空状态 */
    }
    this.ready = true;
    this._unsub = gateway.subscribe((snap) => {
      this.snap = snap;
    });
    this._detach = gateway.attach();
    if (gateway.configured) this._loadAll();
  }

  onDisconnected() {
    this._unsub?.();
    this._unsub = null;
    this._detach?.();
    this._detach = null;
  }

  _say(text, kind = 'ok') {
    this.msg = { text, kind };
    if (this._msgTimer) clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => {
      this.msg = null;
    }, 4200);
  }

  async _loadAll() {
    if (!gateway.configured) return;
    const c = gateway.client();
    const jobs = [
      ['stats', () => c.stats(this.range)],
      ['certs', () => c.certs()],
      ['bans', () => c.bans()],
      ['ddns', () => c.ddns()],
      ['logs', () => c.logs(120)],
      ['procs', () => c.processes()],
    ];
    await Promise.all(
      jobs.map(async ([key, run]) => {
        try {
          const v = await run();
          this[key] = v;
          if (this.errs[key]) {
            this.errs = { ...this.errs, [key]: '' };
          }
        } catch (e) {
          this.errs = { ...this.errs, [key]: e?.message || String(e) };
          this[key] = null;
        }
      }),
    );
    gateway.refresh();
  }

  _reload(key) {
    const c = gateway.client();
    const map = {
      stats: () => c.stats(this.range),
      certs: () => c.certs(),
      bans: () => c.bans(),
      ddns: () => c.ddns(),
      logs: () => c.logs(120),
    };
    const run = map[key];
    if (!run) return;
    run().then(
      (v) => {
        this[key] = v;
        this.errs = { ...this.errs, [key]: '' };
      },
      (e) => {
        this.errs = { ...this.errs, [key]: e?.message || String(e) };
      },
    );
  }

  _openAdmin(path = '') {
    const url = `${this.base}/#${path || '/overview'}`;
    window.open(url, '_blank', 'noopener');
  }

  // ---------- 图表 ----------
  /** 折线 + 面积图：values 已按序排列，返回 svg */
  _chart(series, { height = 120, yFmt = (v) => fmtNum(v) } = {}) {
    const h = typeof height === 'number' ? `${height}px` : height;
    const fill = h === '100%';
    const all = series.flatMap((s) => s.values);
    const top = niceTop(Math.max(1, ...all) * 1.08);
    const W = 600;
    const H = 100;
    const n = Math.max(...series.map((s) => s.values.length));
    const x = (i) => (n <= 1 ? 0 : (i / (n - 1)) * W);
    const y = (v) => H - clamp((v / top) * (H - 6), 0, H - 6);
    const paths = series.map((s) => {
      const pts = s.values.map((v, i) => `${x(i).toFixed(2)} ${y(v).toFixed(2)}`);
      return {
        ...s,
        line: pts.map((p, i) => `${i ? 'L' : 'M'}${p}`).join(' '),
        area: `M0 ${H} L${pts.join(' L')} L${W} ${H} Z`,
      };
    });

    return html`
      <div class="chart ${fill ? 'fill' : ''}" style=${fill ? nothing : `height:${h}`}>
        <div class="yaxis"><span>${yFmt(top)}</span><span>${yFmt(top / 2)}</span><span>0</span></div>
        <div class="plot">
          ${svg`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            ${[0, 0.5, 1].map(
    (g) => svg`<line x1="0" y1=${H * g} x2=${W} y2=${H * g} stroke="rgba(150,170,180,0.14)"
                stroke-width="1" vector-effect="non-scaling-stroke" />`,
  )}
            ${paths.map((p) =>
    p.fill
      ? svg`<path d=${p.area} fill=${p.color} fill-opacity="0.16" />`
      : nothing,
  )}
            ${paths.map(
    (p) => svg`<path d=${p.line} fill="none" stroke=${p.color} stroke-width="1.7"
                stroke-linejoin="round" stroke-linecap="round"
                stroke-dasharray=${p.dashed ? '5 4' : nothing} vector-effect="non-scaling-stroke" />`,
  )}
          </svg>`}
          <div class="xaxis"><span>${this._xLabel(series)}</span></div>
        </div>
      </div>
      <div class="legend">
        ${series.map(
    (s) => html`<span><i style="background:${s.color}"></i>${s.label}<em>${s.note || ''}</em></span>`,
  )}
      </div>
    `;
  }

  _xLabel(series) {
    const s = series[0];
    if (!s || !s.times || s.times.length < 2) return '近期采样';
    const a = new Date(s.times[0] * 1000);
    const b = new Date(s.times[s.times.length - 1] * 1000);
    const f = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${f(a)} → ${f(b)}`;
  }

  // ---------- 小组件 ----------
  _kpi({ label, value, unit, sub, pct, color, icon }) {
    return html`
      <div class="kpi">
        <div class="ktop">
          <span class="klabel">${label}</span>
          ${icon ? html`<span class="kicon" style="color:${color}">${icon}</span>` : ''}
        </div>
        <div class="kval">${value}${unit ? html`<em>${unit}</em>` : ''}</div>
        ${typeof pct === 'number'
    ? html`<div class="kbar"><i style="width:${clamp(pct, 0, 100)}%;background:${color}"></i></div>`
    : ''}
        ${sub ? html`<div class="ksub">${sub}</div>` : ''}
      </div>
    `;
  }

  _empty(text) {
    return html`<div class="blank">${text}</div>`;
  }

  _errBox(key, what) {
    const e = this.errs[key];
    if (!e) return '';
    return html`<div class="warnbox">${what}：${e}</div>`;
  }

  // ---------- 概览 ----------
  _overview() {
    const s = this.snap;
    const g = s.gateway;
    const sites = g?.sites || [];
    const enabled = sites.filter((x) => x.enable).length;
    const unhealthy = sites.filter((x) => x.upstreams.some((u) => !u.healthy)).length;
    const certs = Array.isArray(this.certs) ? this.certs : [];
    const graded = certs.map((c) => ({ c, d: daysLeft(c?.info?.notAfter) })).filter((x) => x.d != null);
    const nextCert =
      graded.filter((x) => x.d >= 0).sort((a, b) => a.d - b.d)[0] ||
      graded.sort((a, b) => b.d - a.d)[0];
    const ddnsTasks = Array.isArray(this.ddns) ? this.ddns : [];

    return html`
      <div class="grid4">
        ${this._kpi({
    label: 'CPU 使用率',
    value: fmtPct(s.cpu, 1),
    pct: s.cpu,
    color: '#fbbf24',
    sub: `${s.cores || '—'} 核 · 负载 ${s.load1.toFixed(2)}`,
  })}
        ${this._kpi({
    label: '内存使用率',
    value: fmtPct(s.memPct, 1),
    pct: s.memPct,
    color: '#f472b6',
    sub: `${fmtBytes(s.memUsed)} / ${fmtBytes(s.memTotal)}`,
  })}
        ${this._kpi({
    label: '请求速率',
    value: g ? fmtNum(g.qps) : '—',
    unit: 'QPS',
    color: '#34d399',
    sub: g ? `处理中 ${fmtNum(g.active)} · 近 60 秒 ${fmtNum(g.qps60)} QPS` : 'Web 服务模块未启用',
  })}
        ${this._kpi({
    label: '实时带宽',
    value: g ? fmtBps(g.bps) : '—',
    color: '#38bdf8',
    sub: g ? `累计请求 ${fmtNum(g.requests)}` : '—',
  })}
      </div>

      <div class="row2">
        <div class="card chartcard">
          <div class="chead">
            <h3>请求趋势</h3>
            <div class="seg">
              ${[30, 60, 120].map(
    (m) => html`<button class="segb ${this.range === m ? 'on' : ''}" @click=${() => this._setRange(m)}>
                  ${m} 分钟
                </button>`,
  )}
            </div>
          </div>
          ${this._trendChart()}
          ${this._errBox('stats', '站点统计不可用')}
        </div>

        <div class="card">
          <div class="chead"><h3>主机与进程</h3><span class="chint">磁盘剩余 ${fmtBytes(s.diskFree)}</span></div>
          <div class="mini6">
            ${[
    ['运行时长', fmtDuration(s.uptime)],
    ['1 分钟负载', s.load1.toFixed(2)],
    ['进程 CPU', fmtPct(s.procCpu, 1)],
    ['进程内存', fmtBytes(s.procRss)],
    ['协程', fmtNum(s.goroutines)],
    ['磁盘占用', fmtPct(s.diskPct, 1)],
  ].map(
    ([k, v]) => html`<div class="mini"><span>${k}</span><b>${v}</b></div>`,
  )}
          </div>
          <div class="chead sub"><h3>进程占用排行</h3>
            <a class="link" @click=${() => this._openAdmin('/perf')}>管理详情 ›</a></div>
          ${Array.isArray(this.procs) && this.procs.length
    ? html`<div class="plist">
                ${this.procs.slice(0, 6).map(
    (p) => html`<div class="prow">
                    <span class="pn">${p.name || p.program}</span>
                    <span class="pv">CPU ${fmtPct(p.cpu, 1)} · ${fmtBytes(p.rss)}</span>
                  </div>`,
  )}
              </div>`
    : html`<div class="chint pad">${this.errs.procs || '没有托管进程'}</div>`}
        </div>
      </div>

      <div class="grid4 low">
        <div class="card tile">
          <div class="chead"><h3>站点</h3><a class="link" @click=${() => (this.tab = 'sites')}>管理详情 ›</a></div>
          <div class="tnum">${enabled}<em>/ ${sites.length || 0} 启用</em></div>
          <div class="chint">${unhealthy ? `${unhealthy} 个后端异常` : '全部后端健康'}</div>
        </div>
        <div class="card tile">
          <div class="chead"><h3>证书</h3><a class="link" @click=${() => (this.tab = 'certs')}>管理详情 ›</a></div>
          <div class="tnum">
            ${nextCert ? (nextCert.d >= 0 ? Math.round(nextCert.d) : '已过期') : '—'}
            <em>${nextCert ? (nextCert.d >= 0 ? '天后到期' : `${Math.abs(Math.round(nextCert.d))} 天`) : ''}</em>
          </div>
          <div class="chint">${nextCert ? nextCert.c.name || nextCert.c.key : this.errs.certs || '没有证书'}</div>
        </div>
        <div class="card tile">
          <div class="chead"><h3>封禁</h3><a class="link" @click=${() => (this.tab = 'bans')}>管理详情 ›</a></div>
          <div class="tnum">${s.guard ? fmtNum(s.guard.bans) : '—'}<em>个地址</em></div>
          <div class="chint">${s.guard ? (s.guard.firewall ? '防火墙已同步' : '防火墙未生效') : this.errs.bans || '防护模块未启用'}</div>
        </div>
        <div class="card tile">
          <div class="chead"><h3>动态域名</h3><a class="link" @click=${() => this._openAdmin('/ddns')}>管理详情 ›</a></div>
          <div class="tnum">${ddnsTasks.filter((t) => t.enable).length}<em>/ ${ddnsTasks.length || 0} 启用</em></div>
          <div class="chint">${ddnsTasks.length ? '按任务间隔自动同步' : this.errs.ddns || '没有 DDNS 任务'}</div>
        </div>
      </div>
    `;
  }

  _setRange(m) {
    this.range = m;
    this.stats = null;
    this._reload('stats');
  }

  _trendChart() {
    const st = this.stats;
    if (st && Array.isArray(st.series) && st.series.length > 1) {
      const times = st.series.map((p) => p.t);
      return this._chart(
        [
          {
            label: '请求数 / 分',
            color: '#34d399',
            fill: true,
            values: st.series.map((p) => p.requests || 0),
            times,
            note: `合计 ${fmtNum(st.series.reduce((a, p) => a + (p.requests || 0), 0))}`,
          },
          {
            label: '5xx',
            color: '#fb7185',
            dashed: true,
            values: st.series.map((p) => p.s5xx || 0),
            times,
          },
        ],
        { height: '100%' },
      );
    }
    // 统计接口不可用时退回面板自己采的样
    const hist = (this.snap.hist || []).slice(-40);
    if (hist.length > 1) {
      return this._chart(
        [
          {
            label: '请求速率（本机采样）',
            color: '#34d399',
            fill: true,
            values: hist.map((h) => h.qps || 0),
            times: hist.map((h) => Math.round(h.t / 1000)),
          },
        ],
        { height: '100%' },
      );
    }
    return html`<div class="blank" style="height:132px">还没有数据，等几轮采样</div>`;
  }

  // ---------- 站点 ----------
  _sites() {
    const g = this.snap.gateway;
    if (!g) {
      return this._empty(this.errs.stats || 'Web 服务模块没有启用，或令牌缺少 webservice:read');
    }
    const list = g.sites || [];
    if (!list.length) return this._empty('还没有站点。到 Gately 后台「Web 服务」里添加');
    return html`
      <div class="table">
        <div class="thead">
          <span class="c-name">站点</span>
          <span class="c-dom">域名</span>
          <span class="c-up">上游</span>
          <span class="c-num">请求</span>
          <span class="c-num">QPS</span>
          <span class="c-sw">启用</span>
        </div>
        ${list.map((s) => this._siteRow(s))}
      </div>
      <div class="chint pad">
        开关会直接改 Gately 的配置（需要令牌带 <code>webservice:write</code>）；点站点名进后台细看
      </div>
    `;
  }

  _siteRow(s) {
    const busyKey = `site:${s.listener}/${s.key}`;
    const bad = s.upstreams.filter((u) => !u.healthy).length;
    return html`
      <div class="trow ${s.enable ? '' : 'off'}">
        <span class="c-name">
          <a class="sname" @click=${() => this._openAdmin('/web')}>${s.name}</a>
          <em class="tag">${s.listenerName}${s.port ? `:${s.port}` : ''}${s.tls ? ' · TLS' : ''}</em>
        </span>
        <span class="c-dom">${(s.domains || []).join('、') || '—'}</span>
        <span class="c-up">
          <i class="dot ${bad ? 'no' : s.running ? 'ok' : 'idle'}"></i>
          ${s.upstreams.length ? (bad ? `${bad} 个异常` : '健康') : '静态/跳转'}
        </span>
        <span class="c-num">${fmtNum(s.requests)}</span>
        <span class="c-num">${fmtNum(s.rate.qps)}</span>
        <span class="c-sw">
          <button
            class="sw ${s.enable ? 'on' : ''} ${this.busy[busyKey] ? 'busy' : ''}"
            @click=${() => this._toggleSite(s)}
            title=${s.enable ? '停用这个站点' : '启用这个站点'}
          >
            <i></i>
          </button>
        </span>
      </div>
    `;
  }

  async _toggleSite(site) {
    const key = `site:${site.listener}/${site.key}`;
    if (this.busy[key]) return;
    this.busy = { ...this.busy, [key]: true };
    try {
      await gateway.client().setSiteEnabled({ listener: site.listener, site: site.key }, !site.enable);
      this._say(`${site.name} 已${site.enable ? '停用' : '启用'}`, 'ok');
      await gateway.refresh();
      this._reload('stats');
    } catch (e) {
      this._say(e?.message || '操作失败', 'err');
    } finally {
      const next = { ...this.busy };
      delete next[key];
      this.busy = next;
    }
  }

  // ---------- 证书 ----------
  _certs() {
    if (this.errs.certs) return this._empty(this.errs.certs);
    const list = Array.isArray(this.certs) ? this.certs : [];
    if (!list.length) return this._empty('还没有证书');
    return html`<div class="cards2">
      ${list.map((c) => {
    const d = daysLeft(c?.info?.notAfter);
    const pct = d == null ? 0 : clamp((d / 90) * 100, 0, 100);
    const color = d == null ? '#94a3b8' : d < 0 ? '#f87171' : d < 14 ? '#fbbf24' : '#34d399';
    const busyKey = `cert:${c.key}`;
    return html`<div class="card cert">
          <div class="chead">
            <h3>${c.name || c.key}</h3>
            <span class="chint">${c.source === 'acme' ? 'ACME 自动签发' : c.source === 'upload' ? '手动上传' : c.source || ''}</span>
          </div>
          <div class="cdom">${(c?.info?.domains || c?.acme?.domains || []).join('、') || '—'}</div>
          <div class="kbar big"><i style="width:${pct}%;background:${color}"></i></div>
          <div class="cfoot">
            <span style="color:${color}">
              ${d == null ? '到期时间未知' : d < 0 ? `已过期 ${Math.abs(Math.round(d))} 天` : `剩 ${Math.round(d)} 天`}
            </span>
            <span class="chint">${fmtDateTime(c?.info?.notAfter)} 到期</span>
            ${c.source === 'acme'
    ? html`<button class="mini-btn" ?disabled=${this.busy[busyKey]} @click=${() => this._renew(c)}>
                  ${this.busy[busyKey] ? '提交中…' : '立即续期'}
                </button>`
    : ''}
          </div>
        </div>`;
  })}
    </div>`;
  }

  async _renew(cert) {
    const key = `cert:${cert.key}`;
    this.busy = { ...this.busy, [key]: true };
    try {
      await gateway.client().renewCert(cert.key);
      this._say('已提交签发请求，稍后刷新查看结果', 'ok');
    } catch (e) {
      this._say(e?.message || '续期失败', 'err');
    } finally {
      const next = { ...this.busy };
      delete next[key];
      this.busy = next;
    }
  }

  // ---------- 封禁 ----------
  _bans() {
    const list = Array.isArray(this.bans) ? this.bans : [];
    return html`
      <div class="card banform">
        <div class="chead"><h3>手动封禁</h3><span class="chint">需要令牌带 guard:write</span></div>
        <div class="row">
          <input class="inp" .value=${this.banIp} placeholder="IPv4 / IPv6 / 网段，如 203.0.113.7 或 203.0.113.0/24"
            @input=${(e) => (this.banIp = e.target.value)} />
          <select class="inp sel" .value=${this.banSec} @change=${(e) => (this.banSec = e.target.value)}>
            <option value="0">默认时长</option>
            <option value="3600">1 小时</option>
            <option value="86400">1 天</option>
            <option value="604800">7 天</option>
            <option value="-1">永久</option>
          </select>
          <button class="primary" @click=${() => this._ban()}>封禁</button>
        </div>
        <input class="inp mt" .value=${this.banReason} placeholder="原因（可留空）"
          @input=${(e) => (this.banReason = e.target.value)} />
      </div>
      ${this._errBox('bans', '封禁名单不可用')}
      ${list.length
    ? html`<div class="table">
            <div class="thead">
              <span class="c-name">地址</span>
              <span class="c-dom">原因</span>
              <span class="c-up">来源</span>
              <span class="c-num">次数</span>
              <span class="c-num">到期</span>
              <span class="c-sw"></span>
            </div>
            ${list.map(
    (b) => html`<div class="trow">
                <span class="c-name mono">${b.key}</span>
                <span class="c-dom">${b.reason || '—'}</span>
                <span class="c-up">${b.source === 'manual' ? '手动' : b.source || '规则'}</span>
                <span class="c-num">${fmtNum(b.count)}</span>
                <span class="c-num">${b.until ? fmtDateTime(b.until) : '永久'}</span>
                <span class="c-sw">
                  <button class="mini-btn" @click=${() => this._unban(b.key)}>解封</button>
                </span>
              </div>`,
  )}
          </div>`
    : html`<div class="blank">当前没有封禁的地址</div>`}
    `;
  }

  async _ban() {
    const ip = this.banIp.trim();
    if (!ip) {
      this._say('先填要封禁的地址', 'err');
      return;
    }
    try {
      await gateway.client().ban(ip, Number(this.banSec) || 0, this.banReason.trim() || '面板手动封禁');
      this.banIp = '';
      this.banReason = '';
      this._say('已封禁', 'ok');
      this._reload('bans');
      gateway.refresh();
    } catch (e) {
      this._say(e?.message || '封禁失败', 'err');
    }
  }

  async _unban(key) {
    try {
      await gateway.client().unban(key);
      this._say(`已解封 ${key}`, 'ok');
      this._reload('bans');
      gateway.refresh();
    } catch (e) {
      this._say(e?.message || '解封失败', 'err');
    }
  }

  // ---------- 日志 ----------
  _logs() {
    if (this.errs.logs) return this._empty(this.errs.logs);
    const list = Array.isArray(this.logs) ? this.logs : [];
    if (!list.length) return this._empty('没有日志');
    return html`<div class="logs">
      ${list.slice().reverse().map(
    (l) => html`<div class="logrow ${l.level || 'info'}">
          <span class="lt">${fmtClock(l.time)}</span>
          <span class="ll">${l.level || 'info'}</span>
          <span class="lm">${l.message}</span>
        </div>`,
  )}
    </div>`;
  }

  // ---------- 渲染 ----------
  _header() {
    const s = this.snap;
    const g = s.gateway;
    const ok = s.phase === 'ok';
    return html`
      <div class="hdr">
        <div class="hid">
          ${logo(30)}
          <div class="hmeta">
            <div class="hname">
              ${s.hostname || hostOf(this.base) || 'Gately'}
              ${s.version ? html`<span class="ver">${s.version}</span>` : ''}
            </div>
            <div class="hsub">
              ${this.base ? html`<span>${this.base.replace(/^https?:\/\//, '')}</span>` : html`<span>还没有配置</span>`}
              ${s.ts ? html`<span>· 最后更新 ${fmtAgo(s.ts / 1000)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="hact">
          <span class="chip ${ok ? 'ok' : s.phase === 'error' ? 'no' : ''}">
            <i class="dot ${ok ? 'ok' : s.phase === 'error' ? 'no' : 'idle'}"></i>
            ${ok ? '已连接' : s.phase === 'error' ? '连接失败' : '连接中'}
          </span>
          ${g
    ? html`<span class="chip"><i class="dot ${g.enabled ? 'ok' : 'idle'}"></i>${g.enabled ? '网关运行中' : '网关已停用'}</span>`
    : ''}
          <button class="btn" @click=${() => this._loadAll()}>刷新</button>
          <button class="btn primary" @click=${() => this._openAdmin('/overview')}>打开后台</button>
        </div>
      </div>
      ${this.msg ? html`<div class="msg ${this.msg.kind}">${this.msg.text}</div>` : ''}
      ${s.phase === 'error' ? html`<div class="warnbox">${s.error}</div>` : ''}
    `;
  }

  render() {
    if (!this.ready) {
      return html`<div class="wrap"><div class="blank">载入中…</div></div>`;
    }
    if (!gateway.configured) {
      return html`<div class="wrap">
        <div class="hdr">
          <div class="hid">${logo(30)}<div class="hmeta"><div class="hname">Gately 网关</div>
            <div class="hsub"><span>还没有配置管理地址与令牌</span></div></div></div>
        </div>
        <div class="blank">
          到导航页这个应用的设置里填 Gately 管理地址与 API 令牌，这里就会显示网关概览。
        </div>
      </div>`;
    }

    const body = {
      overview: () => this._overview(),
      sites: () => this._sites(),
      certs: () => this._certs(),
      bans: () => this._bans(),
      logs: () => this._logs(),
    }[this.tab] || (() => this._overview());

    return html`
      <div class="wrap">
        ${this._header()}
        <div class="tabs">
          ${TABS.map(
    (t) => html`<button class="tab ${this.tab === t.id ? 'on' : ''}" @click=${() => (this.tab = t.id)}>
              ${t.t}
            </button>`,
  )}
        </div>
        <div class="body ${this.tab === 'overview' ? 'ov' : ''}">${body()}</div>
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
      color: #e8eef0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    .wrap {
      height: 100%;
      overflow-y: auto;
      box-sizing: border-box;
      padding: 16px 18px 22px;
      background: radial-gradient(120% 80% at 0% 0%, #16241f 0%, #0c1211 55%, #0b0f14 100%);
      scrollbar-width: thin;
      display: flex;
      flex-direction: column;
    }
    /* 概览让中间一行吃掉剩余高度，窗口拉高时不再留一片空白 */
    .body {
      flex: 0 0 auto;
    }
    .body.ov {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .body.ov > .row2 {
      flex: 1 1 auto;
      min-height: 300px;
    }
    .body.ov > .row2 > .card {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .body.ov .plist {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
    }
    .body.ov .prow {
      flex: 1 1 0;
      min-height: 18px;
    }
    .body.ov .prow + .prow {
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }
    .hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .hid {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .hmeta {
      min-width: 0;
    }
    .hname {
      font-size: 16px;
      font-weight: 650;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ver {
      font-size: 10.5px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.6);
    }
    .hsub {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.42);
      display: flex;
      gap: 6px;
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hact {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 26px;
      padding: 0 10px;
      border-radius: 999px;
      font-size: 11.5px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.07);
      color: rgba(255, 255, 255, 0.7);
      white-space: nowrap;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #64748b;
      display: inline-block;
    }
    .dot.ok {
      background: #34d399;
      box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.2);
    }
    .dot.no {
      background: #f87171;
      box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.2);
    }
    .dot.idle {
      background: #64748b;
    }
    .btn {
      height: 28px;
      padding: 0 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: transparent;
      color: rgba(255, 255, 255, 0.78);
      font-size: 11.5px;
      font-family: inherit;
      cursor: pointer;
    }
    .btn:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .btn.primary {
      background: #18a888;
      border-color: #18a888;
      color: #fff;
      font-weight: 600;
    }
    .btn.primary:hover {
      background: #14957a;
    }
    .msg {
      font-size: 11.5px;
      padding: 6px 10px;
      border-radius: 8px;
      margin-bottom: 10px;
    }
    .msg.ok {
      background: rgba(52, 211, 153, 0.12);
      color: #6ee7b7;
    }
    .msg.err {
      background: rgba(248, 113, 113, 0.12);
      color: #fca5a5;
    }
    .warnbox {
      font-size: 11.5px;
      padding: 7px 10px;
      border-radius: 8px;
      background: rgba(251, 191, 36, 0.1);
      color: #fcd34d;
      margin-bottom: 10px;
      line-height: 1.55;
    }

    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      padding-bottom: 6px;
    }
    .tab {
      height: 26px;
      padding: 0 12px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: rgba(255, 255, 255, 0.55);
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
    }
    .tab:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    .tab.on {
      background: rgba(24, 168, 136, 0.16);
      color: #5eead4;
      font-weight: 600;
    }

    .grid4 {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 10px;
    }
    .grid4.low {
      margin-top: 10px;
      margin-bottom: 0;
    }
    .row2 {
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
      gap: 10px;
      align-items: stretch;
    }
    .chartcard {
      display: flex;
      flex-direction: column;
    }
    .chartcard .chart {
      flex: 1 1 auto;
      min-height: 120px;
    }
    .card {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 12px;
      padding: 11px 13px 12px;
      min-width: 0;
    }
    .kpi {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 12px;
      padding: 10px 12px 11px;
      min-width: 0;
    }
    .ktop {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .klabel {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .kicon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.05);
      font-size: 10px;
    }
    .kval {
      font-size: 21px;
      font-weight: 650;
      line-height: 1.25;
      margin-top: 3px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .kval em {
      font-style: normal;
      font-size: 11px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.42);
      margin-left: 4px;
    }
    .ksub {
      font-size: 10.5px;
      color: rgba(255, 255, 255, 0.42);
      margin-top: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .kbar {
      height: 3px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.09);
      overflow: hidden;
      margin-top: 7px;
    }
    .kbar.big {
      height: 4px;
      margin: 8px 0 7px;
    }
    .kbar i {
      display: block;
      height: 100%;
      border-radius: 2px;
    }

    .chead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .chead.sub {
      margin-top: 10px;
      padding-top: 9px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      margin-bottom: 5px;
    }
    .chead h3 {
      font-size: 12px;
      margin: 0;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.82);
    }
    .chint {
      font-size: 10.5px;
      color: rgba(255, 255, 255, 0.38);
    }
    .chint.pad {
      padding: 6px 2px 2px;
      line-height: 1.6;
    }
    .link {
      font-size: 10.5px;
      color: #5eead4;
      cursor: pointer;
      white-space: nowrap;
    }
    .link:hover {
      text-decoration: underline;
    }
    .seg {
      display: inline-flex;
      gap: 2px;
      padding: 2px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.06);
    }
    .segb {
      height: 20px;
      padding: 0 9px;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: rgba(255, 255, 255, 0.55);
      font-size: 10.5px;
      font-family: inherit;
      cursor: pointer;
    }
    .segb.on {
      background: rgba(24, 168, 136, 0.3);
      color: #ccfbf1;
    }

    .chart {
      display: flex;
      gap: 6px;
      min-width: 0;
    }
    .chart.fill {
      flex: 1 1 auto;
      min-height: 130px;
    }
    .yaxis {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      font-size: 9px;
      color: rgba(255, 255, 255, 0.3);
      text-align: right;
      width: 34px;
      flex: none;
      font-variant-numeric: tabular-nums;
      /* 与 .xaxis 对齐，避免底部的 0 压到时间标签上 */
      padding-bottom: 15px;
      box-sizing: border-box;
    }
    .plot {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .plot svg {
      flex: 1;
      width: 100%;
      display: block;
      overflow: visible;
    }
    .xaxis {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: rgba(255, 255, 255, 0.28);
      margin-top: 3px;
    }
    .legend {
      display: flex;
      gap: 14px;
      margin-top: 7px;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.45);
      flex-wrap: wrap;
    }
    .legend i {
      display: inline-block;
      width: 10px;
      height: 2px;
      border-radius: 1px;
      margin-right: 5px;
      vertical-align: middle;
    }
    .legend em {
      font-style: normal;
      margin-left: 5px;
      color: rgba(255, 255, 255, 0.3);
    }

    .mini6 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .mini {
      background: rgba(255, 255, 255, 0.035);
      border-radius: 8px;
      padding: 6px 8px;
      min-width: 0;
    }
    .mini span {
      display: block;
      font-size: 9.5px;
      color: rgba(255, 255, 255, 0.4);
      white-space: nowrap;
    }
    .mini b {
      font-size: 13px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }
    .plist {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .prow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
    }
    .prow .pn {
      color: rgba(255, 255, 255, 0.68);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .prow .pv {
      color: rgba(255, 255, 255, 0.36);
      flex: none;
      font-variant-numeric: tabular-nums;
    }

    .tile .tnum {
      font-size: 22px;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
    }
    .tile .tnum em {
      font-style: normal;
      font-size: 10.5px;
      font-weight: 400;
      color: rgba(255, 255, 255, 0.38);
      margin-left: 5px;
    }
    .tile .chint {
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* 表格 */
    .table {
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 11px;
      overflow: hidden;
    }
    .thead,
    .trow {
      display: grid;
      grid-template-columns: minmax(120px, 1.1fr) minmax(120px, 1.5fr) 92px 76px 62px 54px;
      gap: 10px;
      align-items: center;
      padding: 8px 12px;
      font-size: 11.5px;
    }
    .thead {
      background: rgba(255, 255, 255, 0.035);
      color: rgba(255, 255, 255, 0.4);
      font-size: 10.5px;
    }
    .trow {
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }
    .trow:hover {
      background: rgba(255, 255, 255, 0.025);
    }
    .trow.off {
      opacity: 0.5;
    }
    .c-name {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .sname {
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sname:hover {
      color: #5eead4;
    }
    .tag {
      font-style: normal;
      font-size: 9.5px;
      color: rgba(255, 255, 255, 0.35);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .c-dom {
      color: rgba(255, 255, 255, 0.55);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .c-up {
      display: flex;
      align-items: center;
      gap: 5px;
      color: rgba(255, 255, 255, 0.5);
      white-space: nowrap;
    }
    .c-num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: rgba(255, 255, 255, 0.62);
    }
    .c-sw {
      text-align: right;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
    }
    .sw {
      width: 32px;
      height: 17px;
      border-radius: 999px;
      border: none;
      background: rgba(255, 255, 255, 0.12);
      position: relative;
      cursor: pointer;
      padding: 0;
    }
    .sw i {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: #e2e8f0;
      transition: transform 0.15s ease;
    }
    .sw.on {
      background: #18a888;
    }
    .sw.on i {
      transform: translateX(15px);
    }
    .sw.busy {
      opacity: 0.5;
      cursor: default;
    }
    .mini-btn {
      height: 22px;
      padding: 0 9px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: transparent;
      color: rgba(255, 255, 255, 0.72);
      font-size: 10.5px;
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .mini-btn:hover {
      background: rgba(255, 255, 255, 0.07);
    }
    .mini-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .cards2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .cert .cdom {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cfoot {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 11px;
      flex-wrap: wrap;
    }
    .cfoot .mini-btn {
      margin-left: auto;
    }

    .banform .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .inp {
      height: 30px;
      padding: 0 9px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.05);
      color: #e8eef0;
      font-size: 11.5px;
      font-family: inherit;
      outline: none;
      flex: 1;
      min-width: 160px;
    }
    .inp:focus {
      border-color: #18a888;
    }
    .inp.sel {
      flex: none;
      width: 110px;
    }
    .inp.mt {
      margin-top: 8px;
      width: 100%;
      box-sizing: border-box;
    }
    .primary {
      height: 30px;
      padding: 0 14px;
      border-radius: 8px;
      border: none;
      background: #18a888;
      color: #fff;
      font-size: 11.5px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      flex: none;
    }
    .primary:hover {
      background: #14957a;
    }

    .logs {
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 11px;
      overflow: hidden;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .logrow {
      display: flex;
      gap: 10px;
      padding: 5px 11px;
      font-size: 11px;
      line-height: 1.5;
      border-top: 1px solid rgba(255, 255, 255, 0.04);
    }
    .logrow:first-child {
      border-top: none;
    }
    .lt {
      color: rgba(255, 255, 255, 0.3);
      flex: none;
    }
    .ll {
      width: 40px;
      flex: none;
      text-transform: uppercase;
      font-size: 9.5px;
      color: rgba(255, 255, 255, 0.35);
      padding-top: 1px;
    }
    .logrow.warn .ll {
      color: #fbbf24;
    }
    .logrow.error .ll {
      color: #f87171;
    }
    .lm {
      color: rgba(255, 255, 255, 0.72);
      word-break: break-word;
    }

    .blank {
      padding: 26px 12px;
      text-align: center;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.4);
      line-height: 1.7;
    }
    @media (max-width: 900px) {
      .grid4 {
        grid-template-columns: 1fr 1fr;
      }
      .row2 {
        grid-template-columns: 1fr;
      }
      .cards2 {
        grid-template-columns: 1fr;
      }
      .thead,
      .trow {
        grid-template-columns: minmax(100px, 1.2fr) minmax(100px, 1.2fr) 70px 50px;
      }
      .c-num:nth-of-type(4),
      .c-num:nth-of-type(5) {
        display: none;
      }
    }
  `;
}
