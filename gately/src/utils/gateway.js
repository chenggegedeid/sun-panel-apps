/**
 * 网关状态单例
 *
 * 一个导航页上可能同时摆着好几个尺寸的卡片，主窗口也读同一份数据，
 * 所以轮询放在这里统一做：同一时刻只发一轮请求，订阅者各自渲染。
 */

import { createClient, GatelyError, normalizeHost } from './api.js';

const DEFAULT_INTERVAL = 15;

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

class GatewayStore {
  constructor() {
    this.conn = { host: '', token: '', interval: DEFAULT_INTERVAL };
    this.snap = emptySnap();
    this.subs = new Set();
    this.refs = 0;
    this.timer = null;
    this.timerApi = null;
    this.inflight = null;
    this._lastAt = 0;
    // 卡片上的趋势曲线靠这里累积：每次轮询压一个点，最多留 120 个
    this.hist = [];
  }

  /** 宿主提供的定时器（api.timer），没有就用原生 */
  setTimerApi(timerApi) {
    this.timerApi = timerApi || null;
  }

  configure({ host, token, interval } = {}) {
    const next = {
      host: String(host ?? this.conn.host ?? '').trim(),
      token: String(token ?? this.conn.token ?? '').trim(),
      interval: Math.min(300, Math.max(5, Number(interval ?? this.conn.interval) || DEFAULT_INTERVAL)),
    };
    const changed = next.host !== this.conn.host || next.token !== this.conn.token;
    const intervalChanged = next.interval !== this.conn.interval;
    this.conn = next;
    if (changed) {
      this.snap = emptySnap();
      this.hist = [];
      this.refresh();
    } else if (intervalChanged && this.refs > 0) {
      this._startTimer();
    }
    return this.conn;
  }

  get configured() {
    return !!normalizeHost(this.conn.host) && !!this.conn.token;
  }

  client() {
    return createClient(this.conn);
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
      this.refresh();
      this._startTimer();
    }
    return () => {
      this.refs = Math.max(0, this.refs - 1);
      if (this.refs === 0) this._stopTimer();
    };
  }

  _startTimer() {
    this._stopTimer();
    if (!this.configured) return;
    const set = this.timerApi?.setInterval || window.setInterval.bind(window);
    this.timer = set(() => this.refresh({ quiet: true }), Math.max(5, this.conn.interval) * 1000);
  }

  _stopTimer() {
    if (this.timer == null) return;
    const clear = this.timerApi?.clearInterval || window.clearInterval.bind(window);
    clear(this.timer);
    this.timer = null;
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
      this._lastAt = Date.now();
      this.inflight = null;
      this._emit();
      return this.snap;
    })();

    return this.inflight;
  }
}

export const gateway = new GatewayStore();
export { DEFAULT_INTERVAL };
