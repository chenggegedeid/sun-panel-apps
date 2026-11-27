/**
 * 网关状态仓库：一台服务器一份
 *
 * 导航页上可能同时摆着好几张卡片，每张盯着不同的机器；主窗口顶部也能切换。
 * 所以轮询按实例分开：每台自己的快照、自己的趋势采样、自己的定时器，
 * 同一实例被多张卡片引用时只发一轮请求（引用计数）。
 *
 * 对外通过 hub 取：
 *   gateway.sync(servers, { interval, defaultId })   同步清单
 *   gateway.get(id)                                  取某台的 store
 *   gateway.list()                                   当前清单
 */

import { createClient, GatelyError, normalizeHost } from './api.js';
import { parseCertPem, certTitle } from './x509.js';
import { daysLeft, fmtPct } from './format.js';

const DEFAULT_INTERVAL = 15;
/** 证书不会分钟级变化，半天拉一次就够 */
const CERT_TTL = 6 * 3600e3;
/** 封禁基线的观察窗口 */
const BAN_WINDOW = 24 * 3600e3;

function emptySnap() {
  return {
    phase: 'idle', // idle | loading | ok | error
    error: '',
    errorKind: '',
    ts: 0,
    // 主机
    name: '',
    version: '',
    hostname: '',
    uptime: 0,
    os: '',
    platform: '',
    cores: 0,
    cpu: 0,
    memPct: 0,
    memUsed: 0,
    memTotal: 0,
    diskPct: 0,
    diskFree: 0,
    diskTotal: 0,
    load1: 0,
    procCpu: 0,
    procRss: 0,
    goroutines: 0,
    moduleTotal: 0,
    moduleEnabled: 0,
    // Web 服务（拓扑），模块关闭时为 null
    gateway: null,
    // 入侵防护
    guard: null,
    // 趋势采样（{t,qps,bps,active}）
    hist: [],
    // 异常清单：{level:'err'|'warn', text, tab}，正常时为空数组
    alerts: [],
  };
}

/** 把 /api/status + /api/webservice/topology + /api/guard/status 揉成一份快照 */
function derive({ status, topo, guard }) {
  const snap = emptySnap();
  snap.ts = Date.now();
  snap.phase = 'ok';

  if (status) {
    const host = status.host || {};
    const cpu = host.cpu || {};
    const mem = host.memory || {};
    const disk = host.disk || {};
    const proc = host.process || {};
    snap.name = host.hostname || '';
    snap.version = status.version || '';
    snap.hostname = host.hostname || '';
    snap.os = [host.platform || host.os, host.kernel].filter(Boolean).join(' · ');
    snap.platform = host.platform || '';
    snap.cores = cpu.cores || 0;
    snap.cpu = Number(cpu.usage) || 0;
    snap.load1 = Array.isArray(cpu.load) ? Number(cpu.load[0]) || 0 : 0;
    snap.memTotal = Number(mem.total) || 0;
    snap.memUsed = Number(mem.used) || 0;
    snap.memPct = snap.memTotal ? (snap.memUsed / snap.memTotal) * 100 : 0;
    snap.diskTotal = Number(disk.total) || 0;
    snap.diskFree = Number(disk.free) || 0;
    snap.diskPct = snap.diskTotal ? ((snap.diskTotal - snap.diskFree) / snap.diskTotal) * 100 : 0;
    snap.procCpu = Number(proc.cpu) || 0;
    snap.procRss = Number(proc.rss) || 0;
    snap.goroutines = Number(proc.goroutines) || 0;
    const start = Date.parse(status.startTime || '');
    snap.uptime = Number.isFinite(start) ? Math.max(0, (Date.now() - start) / 1000) : 0;
    const mods = Array.isArray(status.modules) ? status.modules : [];
    snap.moduleTotal = mods.length;
    snap.moduleEnabled = mods.filter((m) => m?.enabled).length;
  }

  if (topo && typeof topo === 'object' && !Array.isArray(topo)) {
    const listeners = Array.isArray(topo.listeners) ? topo.listeners : [];
    const sites = [];
    let blocked = 0;
    let unhealthy = 0;
    listeners.forEach((l) => {
      (l.sites || []).forEach((s) => {
        const blockedMap = s.blocked || {};
        blocked += Object.values(blockedMap).reduce((a, b) => a + (Number(b) || 0), 0);
        const ups = Array.isArray(s.upstreams) ? s.upstreams : [];
        if (ups.some((u) => u && u.healthy === false)) unhealthy += 1;
        sites.push({
          key: s.key,
          id: s.id || '',
          name: s.name || s.key,
          domains: Array.isArray(s.domains) ? s.domains : [],
          enable: s.enable !== false,
          running: s.running !== false,
          type: s.type || '',
          group: s.group || '',
          requests: Number(s.requests) || 0,
          errors: Number(s.errors) || 0,
          active: Number(s.active) || 0,
          rate: {
            qps: Number(s.rate?.qps) || 0,
            bps: Number(s.rate?.bps) || 0,
            qps60: Number(s.rate?.qps60) || 0,
          },
          status: s.status || {},
          upstreams: (s.upstreams || []).map((u) => ({
            url: u?.url || '',
            healthy: u?.healthy !== false,
            conns: Number(u?.conns) || 0,
            weight: Number(u?.weight) || 1,
          })),
          listener: l.key,
          listenerName: l.name || l.key,
          port: l.port,
          tls: !!l.tls,
        });
      });
    });
    sites.sort((a, b) => b.rate.qps - a.rate.qps);
    snap.gateway = {
      enabled: topo.enabled !== false,
      qps: Number(topo.rate?.qps) || 0,
      qps60: Number(topo.rate?.qps60) || 0,
      bps: Number(topo.rate?.bps) || 0,
      requests: Number(topo.requests) || 0,
      active: Number(topo.active) || 0,
      blocked,
      unhealthy,
      window: Number(topo.window) || 10,
      listeners: listeners.map((l) => ({
        key: l.key,
        name: l.name || l.key,
        port: Number(l.port) || 0,
        tls: !!l.tls,
        running: l.running !== false,
        enable: l.enable !== false,
        requests: Number(l.requests) || 0,
        active: Number(l.active) || 0,
        rate: { qps: Number(l.rate?.qps) || 0, bps: Number(l.rate?.bps) || 0 },
        siteCount: (l.sites || []).length,
      })),
      sites,
    };
  }

  if (guard && typeof guard === 'object') {
    snap.guard = {
      bans: Number(guard.bans) || 0,
      firewall: guard.firewall?.active === true,
      guardEnabled: guard.firewall?.enabled !== false,
      dropped: Number(guard.firewall?.dropped?.ban) || 0,
      trapPorts: guard.firewall?.trapPorts || '',
    };
  }

  return snap;
}

/** 一台服务器的状态与轮询 */
export class GatewayStore {
  /**
   * @param {{id:string,name?:string,host:string,token:string}} server
   * @param {() => any} getTimerApi 取宿主定时器
   */
  constructor(server, getTimerApi) {
    this.server = { id: '', name: '', host: '', token: '', ...server };
    this._getTimerApi = getTimerApi;
    this.interval = DEFAULT_INTERVAL;
    this.snap = emptySnap();
    this.subs = new Set();
    this.refs = 0;
    this.timer = null;
    this.inflight = null;
    this._lastAt = 0;
    // 卡片上的趋势曲线靠这里累积：每次轮询压一个点，最多留 120 个
    this.hist = [];
    // 全站趋势按 minutes 缓存，避免主窗口和卡片各拉一遍
    this._trendCache = {};
    // 最近到期的证书（半天拉一次就够了）
    this.certInfo = null;
    this._certAt = 0;
    // 封禁数的 24 小时基线，用来判断「突然涨了」
    this._banBase = null;
  }

  get id() {
    return this.server.id;
  }

  get name() {
    return this.server.name;
  }

  get host() {
    return this.server.host;
  }

  get configured() {
    return !!normalizeHost(this.server.host) && !!this.server.token;
  }

  client() {
    return createClient(this.server);
  }

  /** 换地址或令牌时把旧数据清干净，避免拿上一台的数字冒充新的 */
  setServer(server) {
    const next = { ...this.server, ...server };
    const changed = next.host !== this.server.host || next.token !== this.server.token;
    const renamed = next.name !== this.server.name;
    this.server = next;
    if (changed) {
      this.snap = emptySnap();
      this.hist = [];
      this._trendCache = {};
      if (this.refs > 0) {
        this.refresh();
        this._startTimer();
      }
    } else if (renamed) {
      // 只是改了名字：数据不变，但卡片标题要跟着换
      this._emit();
    }
    return this;
  }

  setInterval(sec) {
    const next = Math.min(300, Math.max(5, Number(sec) || DEFAULT_INTERVAL));
    if (next === this.interval) return this;
    this.interval = next;
    if (this.refs > 0) this._startTimer();
    return this;
  }

  subscribe(fn) {
    this.subs.add(fn);
    fn(this.snap);
    return () => this.subs.delete(fn);
  }

  _emit() {
    const snap = this.snap;
    this.subs.forEach((fn) => {
      try {
        fn(snap);
      } catch {
        /* 单个订阅者出错不影响其它卡片 */
      }
    });
  }

  /** 引用计数：最后一张卡片关掉时停止轮询 */
  attach() {
    this.refs += 1;
    if (this.refs === 1) {
      if (this.configured) {
        this.refresh();
        this._startTimer();
      }
    }
    return () => {
      this.refs = Math.max(0, this.refs - 1);
      if (this.refs === 0) this._stopTimer();
    };
  }

  _timerApi() {
    return this._getTimerApi?.() || null;
  }

  _startTimer() {
    this._stopTimer();
    if (!this.configured) return;
    const api = this._timerApi();
    const set = api?.setInterval || window.setInterval.bind(window);
    this.timer = set(() => this.refresh({ quiet: true }), Math.max(5, this.interval) * 1000);
  }

  _stopTimer() {
    if (this.timer == null) return;
    const api = this._timerApi();
    const clear = api?.clearInterval || window.clearInterval.bind(window);
    clear(this.timer);
    this.timer = null;
  }

  /**
   * 全站请求趋势（分钟级）
   *
   * Gately 没有「全站合计」的历史接口：topology 只带最近 60 秒的秒级曲线，
   * /api/perf/overview 只有主机指标，能拿到分钟级请求量的只有单站点的
   * /api/webservice/stats（必须带 listener + site）。所以这里按正在运行的站点
   * 逐个取回，再按分钟把 requests / bytes / 4xx / 5xx 加总。
   *
   * 接口本身就是分钟粒度，缓存 60 秒足够；并发限 6，站点多的实例也不会打满。
   */
  async fetchTrend(minutes = 30, { force = false } = {}) {
    const key = String(minutes);
    const now = Date.now();
    const hit = this._trendCache[key];
    if (!force && hit && now - hit.at < 60000) return hit.value;

    const g = this.snap.gateway;
    const pairs = (g?.sites || [])
      .filter((s) => s.running && s.enable && s.listener)
      .map((s) => ({ listener: s.listener, site: s.key }));

    if (!pairs.length) {
      // 拓扑还没回来或没有运行中的站点，不缓存，等下一轮
      return { series: [], ok: 0, fail: 0, total: 0, error: '', at: now };
    }

    const client = this.client();
    const buckets = new Map();
    const queue = pairs.slice();
    let ok = 0;
    let fail = 0;
    let lastErr = '';

    const worker = async () => {
      for (;;) {
        const job = queue.shift();
        if (!job) return;
        try {
          const v = await client.stats({ ...job, minutes });
          ok += 1;
          (Array.isArray(v?.series) ? v.series : []).forEach((p) => {
            const t = Number(p?.t) || 0;
            if (!t) return;
            const cur = buckets.get(t) || { t, requests: 0, bytes: 0, s4xx: 0, s5xx: 0 };
            cur.requests += Number(p.requests) || 0;
            cur.bytes += Number(p.bytes) || 0;
            cur.s4xx += Number(p.s4xx) || 0;
            cur.s5xx += Number(p.s5xx) || 0;
            buckets.set(t, cur);
          });
        } catch (e) {
          fail += 1;
          lastErr = e instanceof GatelyError ? e.message : String(e?.message || e);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(6, pairs.length) }, worker));

    const value = {
      series: [...buckets.values()].sort((a, b) => a.t - b.t),
      ok,
      fail,
      total: pairs.length,
      // 全部站点都失败才算不可用；个别站点失败不影响合计曲线
      error: ok ? '' : lastErr,
      at: Date.now(),
    };
    this._trendCache[key] = { at: value.at, value };
    return value;
  }

  /**
   * 证书到期情况：半天拉一次。
   *
   * 卡片要能说「证书 6 天后到期」，但证书几乎不变，按轮询频率拉会把接口打满；
   * 权限不足或 ssl 模块关闭时静默失败 —— 不能因为看不了证书就把整张卡拖成错误态。
   */
  async _loadCerts() {
    const now = Date.now();
    if (this._certAt && now - this._certAt < CERT_TTL) return;
    this._certAt = now;
    try {
      const list = await this.client().certs();
      let best = null;
      (Array.isArray(list) ? list : []).forEach((c) => {
        const pem = c?.certPem ? parseCertPem(c.certPem) : null;
        const iso = c?.info?.notAfter || (pem?.notAfter ? new Date(pem.notAfter).toISOString() : '');
        const d = daysLeft(iso);
        if (d == null) return;
        if (!best || d < best.days) {
          best = { days: d, name: certTitle(c, pem || { domains: [], notAfter: 0, issuer: '' }) };
        }
      });
      this.certInfo = best;
    } catch {
      /* 没 ssl:read 或模块没开，下次再试 */
    }
  }

  /**
   * 汇总这一台现在有几件事值得提。
   * 上游用宽松判定：一个站点所有上游都不健康才算它挂了，避免备份节点长期挂着导致天天空报。
   */
  _applyAlerts(snap) {
    const out = [];
    const g = snap.gateway;
    if (!snap.ts) {
      snap.alerts = out;
      return;
    }

    if (g && !g.enabled) out.push({ level: 'err', text: '网关已停用', tab: 'overview' });

    if (g) {
      const dead = g.sites.filter(
        (s) => s.enable && s.running && s.upstreams.length && s.upstreams.every((u) => !u.healthy),
      );
      if (dead.length) {
        out.push({
          level: 'warn',
          text: dead.length === 1 ? `「${dead[0].name}」后端全挂` : `${dead.length} 个站点后端全挂`,
          tab: 'sites',
        });
      }
    }

    if (snap.diskPct >= 90) {
      out.push({ level: 'warn', text: `磁盘已用 ${fmtPct(snap.diskPct, 0)}`, tab: 'overview' });
    }

    if (this.certInfo) {
      const d = this.certInfo.days;
      if (d < 0) out.push({ level: 'err', text: '证书已过期', tab: 'certs' });
      else if (d <= 14) out.push({ level: 'warn', text: `证书 ${Math.round(d)} 天后到期`, tab: 'certs' });
    }

    const jump = this._checkBans(snap.guard);
    if (jump >= 10) out.push({ level: 'warn', text: `封禁 24h 增 ${jump} 条`, tab: 'bans' });

    // 严重的排前面：小卡片只放得下第一条，得让最该看的那条站前面
    out.sort((a, b) => (a.level === 'err' ? 0 : 1) - (b.level === 'err' ? 0 : 1));
    snap.alerts = out;
  }

  /** 封禁数的 24 小时基线：第一次只记录不说话，攒够窗口再比 */
  _checkBans(guard) {
    const count = Number(guard?.bans) || 0;
    const now = Date.now();
    if (!this._banBase || now - this._banBase.at > BAN_WINDOW) {
      this._banBase = { at: now, count };
      return 0;
    }
    return Math.max(0, count - this._banBase.count);
  }

  async refresh({ quiet = false } = {}) {
    if (!this.configured) {
      this.snap = emptySnap();
      this._emit();
      return this.snap;
    }
    // 页面在后台时不打扰服务器，回到前台会立刻补一次
    if (quiet && typeof document !== 'undefined' && document.hidden) return this.snap;
    if (this.inflight) return this.inflight;

    const client = this.client();
    if (!quiet || this.snap.phase !== 'ok') {
      this.snap = { ...this.snap, phase: 'loading' };
      this._emit();
    }

    this.inflight = (async () => {
      const pick = (p) =>
        p.then(
          (v) => ({ ok: true, v }),
          (e) => ({ ok: false, e }),
        );
      // status 决定整体成败；拓扑与防护在模块关闭时会 403，属于正常情况
      const statusRes = await pick(client.status());
      if (!statusRes.ok) {
        const e = statusRes.e;
        this.snap = {
          ...emptySnap(),
          phase: 'error',
          error: e instanceof GatelyError ? e.message : String(e?.message || e),
          errorKind: e?.kind || 'unknown',
          hist: this.hist.slice(),
        };
        this.inflight = null;
        this._emit();
        return this.snap;
      }
      const [topoRes, guardRes] = await Promise.all([pick(client.topology()), pick(client.guardStatus())]);
      this.snap = derive({
        status: statusRes.v,
        topo: topoRes.ok ? topoRes.v : null,
        guard: guardRes.ok ? guardRes.v : null,
      });
      this.hist.push({
        t: this.snap.ts,
        qps: this.snap.gateway?.qps || 0,
        bps: this.snap.gateway?.bps || 0,
        active: this.snap.gateway?.active || 0,
      });
      if (this.hist.length > 120) this.hist.splice(0, this.hist.length - 120);
      this.snap.hist = this.hist.slice();
      this._applyAlerts(this.snap);
      this._lastAt = Date.now();
      this.inflight = null;
      this._emit();
      // 证书半天才变，放后台拉，别拖慢这一轮；拿到后重算一次异常再推给界面
      if (!this.certInfo || Date.now() - this._certAt > CERT_TTL) {
        this._loadCerts().then(() => {
          this._applyAlerts(this.snap);
          this._emit();
        });
      }
      return this.snap;
    })();

    return this.inflight;
  }
}

/** 服务器清册：把清单变成一组 store，地址变了就重建 */
class GatewayHub {
  constructor() {
    this.stores = new Map();
    this.servers = [];
    this.defaultId = '';
    this.interval = DEFAULT_INTERVAL;
    this.timerApi = null;
    this.listSubs = new Set();
  }

  setTimerApi(timerApi) {
    this.timerApi = timerApi || null;
  }

  _getTimerApi() {
    return this.timerApi;
  }

  /**
   * 同步服务器清单。
   * 已经在跑的实例只更新字段，不会重建（否则卡片上的曲线会被清空）。
   */
  sync(servers, { interval, defaultId } = {}) {
    const list = Array.isArray(servers) ? servers : [];
    this.servers = list;
    this.interval = Math.min(300, Math.max(5, Number(interval) || DEFAULT_INTERVAL));
    const ids = new Set(list.map((s) => s.id));

    // 删掉的实例：停表、断开订阅
    [...this.stores.keys()].forEach((id) => {
      if (!ids.has(id)) {
        const st = this.stores.get(id);
        st._stopTimer();
        this.stores.delete(id);
      }
    });

    list.forEach((s) => {
      let st = this.stores.get(s.id);
      if (!st) {
        st = new GatewayStore(s, () => this._getTimerApi());
        this.stores.set(s.id, st);
      } else {
        st.setServer(s);
      }
      st.setInterval(this.interval);
    });

    this.defaultId = this.stores.has(defaultId) ? defaultId : list[0]?.id || '';
    this._emitList();
    return this;
  }

  /** 当前清单（脱敏：不带令牌） */
  list() {
    return this.servers.map((s) => ({ id: s.id, name: s.name, host: s.host }));
  }

  get empty() {
    return this.stores.size === 0;
  }

  /** 取某台的 store；id 不在清单里时退回默认那台 */
  get(id) {
    if (id && this.stores.has(id)) return this.stores.get(id);
    if (this.defaultId && this.stores.has(this.defaultId)) return this.stores.get(this.defaultId);
    return this.stores.values().next().value || null;
  }

  /** 全部实例（预览页预灌采样用） */
  all() {
    return [...this.stores.values()];
  }

  /** 有没有任何一台配好 */
  get configured() {
    for (const st of this.stores.values()) if (st.configured) return true;
    return false;
  }

  /** 监听清单变化（主窗口的切换条用） */
  subscribeList(fn) {
    this.listSubs.add(fn);
    fn(this.list());
    return () => this.listSubs.delete(fn);
  }

  _emitList() {
    const l = this.list();
    this.listSubs.forEach((fn) => {
      try {
        fn(l);
      } catch {
        /* ignore */
      }
    });
  }
}

export const gateway = new GatewayHub();
export { DEFAULT_INTERVAL, emptySnap };
