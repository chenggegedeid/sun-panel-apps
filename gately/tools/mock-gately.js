/**
 * 开发用 Gately 模拟器（只在 npm run dev 时生效，不进打包产物）
 *
 * 按 Gately 真实接口的形状返回数据，站点启停 / 封禁 / 解封 / 续期会真的改内存状态，
 * 这样不接真机也能把交互走一遍。数据全部用文档地址（192.0.2.x / example.com）。
 */

const MIN = 60;

function state() {
  const t = Math.floor(Date.now() / 1000);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const sites = [
    { key: 's-blog', name: '博客', listener: 'l-pub', domains: ['blog.example.com', 'www.example.com'], up: 'http://192.0.2.21:2368', weight: 60 },
    { key: 's-photos', name: '相册', listener: 'l-pub', domains: ['photo.example.com'], up: 'http://192.0.2.22:2283', weight: 40 },
    { key: 's-git', name: '代码托管', listener: 'l-pub', domains: ['git.example.com'], up: 'http://192.0.2.23:3000', weight: 25 },
    { key: 's-lab', name: '实验室（泛域名）', listener: 'l-pub', domains: ['*.lab.example.com'], up: 'http://192.0.2.40:8080', weight: 18, ups: 3 },
    { key: 's-panel', name: '面板', listener: 'l-priv', domains: ['panel.example.com'], up: 'https://192.0.2.30:5666', weight: 4 },
    { key: 's-media', name: '影音', listener: 'l-priv', domains: ['media.example.com'], up: 'http://192.0.2.31:8096', weight: 12, down: true },
  ].map((s) => ({
    ...s,
    enable: true,
    requests: Math.round(120000 * (s.weight / 10)) + 4000,
    qps: +(s.weight / 22 + rnd() * 0.6).toFixed(2),
    bps: Math.round((s.weight * 42 + rnd() * 2000) * 1024),
  }));

  const bans = [
    { key: '198.51.100.0/26', reason: '长期扫描的网段，手动封禁', source: 'manual', count: 1, created: new Date(Date.now() - 6 * 86400e3).toISOString() },
    { key: '203.0.113.42', reason: '失败 12 次 SSH 登录', source: 'jail:sshd', count: 12, created: new Date(Date.now() - 3 * 3600e3).toISOString(), until: new Date(Date.now() + 21 * 3600e3).toISOString() },
    { key: '2001:db8:bad::/48', reason: 'WAF 规则 942100 多次触发', source: 'jail:waf', count: 8, created: new Date(Date.now() - 40 * 60e3).toISOString(), until: new Date(Date.now() + 20 * 3600e3).toISOString() },
  ];

  const statsSeries = Array.from({ length: 60 }, (_, i) => {
    const wave = Math.sin(i / 6) * 0.45 + Math.sin(i / 2.3) * 0.22;
    const base = 34 * (1 + wave);
    return {
      t: t - (59 - i) * MIN,
      requests: Math.max(3, Math.round(base + rnd() * 6)),
      bytes: Math.round((base * 42000 + rnd() * 400000) / 1000) * 1000,
      p50: Math.round(18 + rnd() * 12),
      p95: Math.round(110 + rnd() * 60),
      s4xx: Math.round(rnd() * 4),
      s5xx: rnd() > 0.94 ? Math.round(rnd() * 3) : 0,
    };
  });

  return { sites, bans, statsSeries, t };
}

const S = state();

function topology() {
  const t = Math.floor(Date.now() / 1000);
  // 平滑波动：按秒数取正弦，轮询时数据连续变化，曲线不会像随机噪声
  const phase = t / 11;
  const jitter = () => 1 + Math.sin(phase) * 0.12 + Math.sin(phase * 2.7) * 0.05;
  const pubSites = S.sites.filter((x) => x.listener === 'l-pub');
  const privSites = S.sites.filter((x) => x.listener === 'l-priv');
  const mk = (s) => ({
    key: s.key,
    id: `s:${s.listener}/${s.key}`,
    name: s.name,
    enable: s.enable,
    running: s.enable,
    type: 'proxy',
    group: s.listener === 'l-pub' ? '对外站点' : '内网站点',
    domains: s.domains,
    accessLog: true,
    active: Math.round(s.qps * 2 * jitter()),
    requests: s.requests,
    errors: Math.round(s.requests * 0.004),
    blocked: s.key === 's-photos' ? { waf: 6, ban: 2 } : {},
    rate: { qps: s.enable ? s.qps * jitter() : 0, bps: s.enable ? s.bps * jitter() : 0, qps60: s.qps },
    status: { '2xx': Math.round(s.requests * 0.86), '3xx': Math.round(s.requests * 0.08), '4xx': Math.round(s.requests * 0.05), '5xx': Math.round(s.requests * 0.01) },
    upstreams: Array.from({ length: s.ups || 1 }, (_, i) => ({
      id: `u:${s.listener}/${s.key}/${i}`,
      url: s.ups ? s.up.replace(':8080', `:${8080 + i}`) : s.up,
      healthy: !s.down,
      weight: 1,
      conns: s.enable ? Math.round(s.qps * 1.4) : 0,
      requests: s.requests,
      bytes: s.bps * 900,
      rate: { qps: s.qps, bps: s.bps, qps60: s.qps },
    })),
  });

  const listeners = [
    {
      key: 'l-pub', id: 'l:l-pub', name: '公网 HTTPS 入口', port: 443, tls: true, http3: true,
      httpPort: 80, httpPortMode: 'redirect', plainHttp: 'redirect', listenIp: '', network: 'tcp',
      proxyProtocol: false, enable: true, running: true,
      active: pubSites.reduce((a, s) => a + Math.round(s.qps * 2), 0),
      requests: pubSites.reduce((a, s) => a + s.requests, 0),
      rate: { qps: pubSites.reduce((a, s) => a + (s.enable ? s.qps : 0), 0), bps: pubSites.reduce((a, s) => a + (s.enable ? s.bps : 0), 0), qps60: 34 },
      sites: pubSites.map(mk),
    },
    {
      key: 'l-priv', id: 'l:l-priv', name: '内网入口', port: 8443, tls: true, http3: false,
      httpPort: 0, httpPortMode: '', plainHttp: '', listenIp: '192.0.2.1', network: 'tcp',
      proxyProtocol: false, enable: true, running: true,
      active: privSites.reduce((a, s) => a + Math.round(s.qps * 2), 0),
      requests: privSites.reduce((a, s) => a + s.requests, 0),
      rate: { qps: privSites.reduce((a, s) => a + (s.enable ? s.qps : 0), 0), bps: privSites.reduce((a, s) => a + (s.enable ? s.bps : 0), 0), qps60: 6 },
      sites: privSites.map(mk),
    },
  ];

  const enabledSites = S.sites.filter((s) => s.enable);
  return {
    active: listeners.reduce((a, l) => a + l.active, 0),
    enabled: true,
    ipTotal: 24,
    ipTruncated: false,
    ips: S.sites.slice(0, 5).map((s, i) => ({
      ip: `192.0.2.${100 + i}`,
      active: Math.round(s.qps),
      last: t - i * 13,
      nodes: [`s:${s.listener}/${s.key}`],
    })),
    listeners,
    rate: {
      bps: enabledSites.reduce((a, s) => a + s.bps, 0) * (0.92 + Math.random() * 0.16),
      qps: enabledSites.reduce((a, s) => a + s.qps, 0) * (0.92 + Math.random() * 0.16),
      qps60: 34.7,
    },
    requests: 10800214 + Math.round((Date.now() / 1000 % 600) * 6),
    time: t,
    window: 10,
  };
}

function status() {
  const t = Math.floor(Date.now() / 1000);
  const memTotal = 17179869184;
  const memUsed = 6865912350 + Math.round(Math.random() * 300e6);
  const diskTotal = 274877906944;
  const diskUsed = 79456894976;
  return {
    arch: 'amd64',
    build: { absent: [], custom: false, languages: ['zh-CN', 'en'], modules: [] },
    buildDate: '2026-11-17T12:17:45Z',
    commit: '1869b4f1ee7cf175f235fbe11eceb2d57a3205fa',
    configDir: '/data',
    goVersion: 'go1.26.11',
    goroutines: 74,
    host: {
      arch: 'amd64',
      bootTime: t - 6 * 86400 - 4210,
      cpu: { cores: 4, load: [0.52, 0.61, 0.58], model: 'Intel(R) N100', usage: 18.4 + Math.random() * 6 },
      disk: { free: diskTotal - diskUsed, path: '/etc/gately', total: diskTotal, used: diskUsed },
      hostname: 'gately',
      inContainer: true,
      interfaces: [
        { ipv4: ['192.0.2.1/24'], ipv6: ['2001:db8::1/64'], mac: '02:00:5e:00:53:10', mtu: 1500, name: 'eth0', rxBytes: 188939920000, rxRate: 3.1e6, txBytes: 99018840000, txRate: 1.2e6 },
      ],
      kernel: '6.12.4-fnos',
      managed: [],
      memory: { available: memTotal - memUsed, swapTotal: 2147483648, swapUsed: 125829120, total: memTotal, used: memUsed },
      os: 'linux',
      platform: 'Debian GNU/Linux 12',
      process: { cpu: 1.5, fds: 36, goroutines: 74, heapAlloc: 22020096, heapSys: 39845888, numGC: 588, pid: 1, rss: 54326716, threads: 18 },
      sampledAt: new Date().toISOString(),
    },
    modules: [
      { id: 'portforward', title: '端口转发', enabled: true },
      { id: 'ddns', title: '动态域名', enabled: true },
      { id: 'ssl', title: 'SSL 证书', enabled: true },
      { id: 'webservice', title: 'Web 服务', enabled: true },
      { id: 'guard', title: '入侵防护', enabled: true },
      { id: 'waf', title: 'WAF 防火墙', enabled: true },
      { id: 'docker', title: 'Docker 管理', enabled: false },
      { id: 'terminal', title: 'Web 终端', enabled: false },
    ],
    startTime: new Date((t - 6 * 86400 - 4210) * 1000).toISOString(),
    timeZone: 'Asia/Shanghai (UTC+08:00)',
    version: 'v0.6.8.8',
  };
}

function certs() {
  const mk = (key, name, domains, days, source) => ({
    key,
    name,
    enable: true,
    group: '公网',
    source,
    acme: source === 'acme' ? { ca: 'letsencrypt', challenge: 'dns', domains, email: 'admin@example.com', provider: 'cloudflare', keyType: 'P256' } : null,
    info: {
      domains,
      issuer: 'R11',
      notBefore: new Date(Date.now() - (90 - days) * 86400e3).toISOString(),
      notAfter: new Date(Date.now() + days * 86400e3).toISOString(),
      fingerprint: '21e921aac2e35f8ffbadaca5c3defdb6',
    },
    deploys: [],
    state: { obtaining: false },
    updatedAt: new Date(Date.now() - 30 * 86400e3).toISOString(),
  });
  return [
    mk('c-wild', '泛域名证书', ['*.example.com', 'example.com'], 34, 'acme'),
    mk('c-lab', '实验室域名', ['*.lab.example.com'], 6, 'acme'),
    mk('c-old', '旧站点证书', ['legacy.example.com'], -4, 'upload'),
  ];
}

function bans() {
  return S.bans.map((b) => ({ ...b }));
}

function guardStatus() {
  return {
    bans: S.bans.length,
    firewall: { active: true, enabled: true, dropped: { ban: 18422, trap: 903 }, hits: {}, openPorts: 0, redirect: true, trapPorts: '2323,3306,6379,27017', trapSkipped: [] },
    platform: { docker: true, inDocker: true, journal: false, os: 'linux' },
    userTrapPorts: [],
  };
}

function ddns() {
  return [
    { key: 'd-cf', name: 'Cloudflare：example.com', enable: true, provider: 'cloudflare', group: '公网域名', interval: 300, records: [{}, {}], state: { ipv4: '198.51.100.7', lastRun: new Date(Date.now() - 120e3).toISOString(), nextRun: new Date(Date.now() + 180e3).toISOString(), running: false, records: [] } },
    { key: 'd-ali', name: '阿里云：lab.example.com', enable: false, provider: 'alidns', group: '公网域名', interval: 600, records: [{}], state: { ipv4: '198.51.100.7', lastRun: new Date(Date.now() - 3600e3).toISOString(), running: false } },
  ];
}

function logs(limit) {
  const t = Date.now();
  const rows = [
    ['info', 'Web 服务监听 :443，HTTP/3 已启用'],
    ['info', '证书“泛域名证书”剩余 34 天，下次续期在 20 天后'],
    ['warn', '站点“影音”后端 192.0.2.31:8096 连续 3 次探测失败，已摘除'],
    ['info', 'DDNS 任务“Cloudflare：example.com”同步成功：198.51.100.7'],
    ['warn', '入侵防护封禁 203.0.113.42（失败 12 次 SSH 登录）'],
    ['info', 'WAF 拦截 2001:db8:bad::/48 的规则 942100 请求'],
    ['info', '配置已保存：站点“实验室（泛域名）”新增域名 *.lab.example.com'],
  ];
  return rows.slice(0, limit).map(([level, message], i) => ({
    level,
    message,
    seq: 120 - i,
    time: new Date(t - i * 95e3).toISOString(),
  }));
}

function processes() {
  return [
    { module: 'frp', name: '香港中转', program: 'frpc', pid: 211, cpu: 0.7, rss: 31457280, threads: 11, restarts: 0, since: new Date(Date.now() - 5 * 86400e3).toISOString(), samples: [] },
    { module: 'tailscale', name: 'tailscaled', program: 'tailscaled', pid: 254, cpu: 1.7, rss: 73400320, threads: 14, restarts: 0, since: new Date(Date.now() - 9 * 86400e3).toISOString(), samples: [] },
    { module: 'cloudflared', name: '隧道', program: 'cloudflared', pid: 311, cpu: 0.4, rss: 26214400, threads: 9, restarts: 1, since: new Date(Date.now() - 86400e3).toISOString(), samples: [] },
  ];
}

function stats(minutes) {
  const n = Math.max(1, Math.min(180, Number(minutes) || 30));
  const series = S.statsSeries.slice(-n);
  const sum = (k) => series.reduce((a, p) => a + (p[k] || 0), 0);
  return {
    series,
    bytesOut: sum('bytes'),
    status: { '2xx': Math.round(sum('requests') * 0.86), '3xx': Math.round(sum('requests') * 0.08), '4xx': Math.round(sum('requests') * 0.05), '5xx': sum('s5xx') },
    blocked: { ban: 110, country: 0, ip: 66, rateLimit: 24, waf: 142 },
    topCountries: [{ key: 'CN', count: 18220 }, { key: 'US', count: 3140 }, { key: 'SG', count: 1280 }],
    topIps: [{ key: '192.0.2.28', count: 24864 }, { key: '2001:db8:4::4', count: 14208 }],
    upstreams: null,
  };
}

function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, code, data) {
  const payload = JSON.stringify(data);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(payload);
}

export function mockGately() {
  return {
    name: 'mock-gately',
    configureServer(server) {
      server.middlewares.use('/mock-gately', async (req, res, next) => {
        const url = new URL(req.url, 'http://x');
        const path = url.pathname.replace(/^\/mock-gately/, '');
        const method = req.method || 'GET';

        if (path === '/api/status') return json(res, 200, status());
        if (path === '/api/session') return json(res, 200, { username: 'api-token:面板', role: 'admin', disabledModules: ['docker', 'webterminal'], absentModules: [], defaultPassword: false, passwordIssue: '' });
        if (path === '/api/webservice/topology') return json(res, 200, topology());
        if (path === '/api/webservice/stats') return json(res, 200, stats(url.searchParams.get('minutes')));
        if (path === '/api/ssl/certs') return json(res, 200, certs());
        if (path === '/api/guard/bans' && method === 'GET') return json(res, 200, bans());
        if (path === '/api/guard/status') return json(res, 200, guardStatus());
        if (path === '/api/ddns/tasks') return json(res, 200, ddns());
        if (path === '/api/logs') return json(res, 200, logs(Number(url.searchParams.get('limit')) || 80));
        if (path === '/api/perf/processes') return json(res, 200, processes());

        if (path === '/api/webservice/sites/batch' && method === 'POST') {
          const b = await body(req);
          const ref = (b.sites || [])[0] || {};
          const s = S.sites.find((x) => x.key === ref.site);
          if (!s) return json(res, 400, { error: '站点不存在' });
          s.enable = b.action === 'enable';
          return json(res, 200, { changed: 1, unchanged: 0 });
        }
        if (path === '/api/guard/bans' && method === 'POST') {
          const b = await body(req);
          if (!b.key) return json(res, 400, { error: '请填写地址' });
          S.bans.push({ key: b.key, reason: b.reason || '面板手动封禁', source: 'manual', count: 1, created: new Date().toISOString(), until: Number(b.seconds) > 0 ? new Date(Date.now() + Number(b.seconds) * 1000).toISOString() : undefined });
          return json(res, 200, S.bans[S.bans.length - 1]);
        }
        if (path === '/api/guard/bans' && method === 'DELETE') {
          const b = await body(req);
          const i = S.bans.findIndex((x) => x.key === b.key);
          if (i >= 0) S.bans.splice(i, 1);
          return json(res, 200, { ok: true });
        }
        if (/^\/api\/ssl\/certs\/.+\/renew$/.test(path)) return json(res, 200, { ok: true });
        if (/^\/api\/ddns\/tasks\/.+\/sync$/.test(path)) return json(res, 200, { ok: true });

        next();
      });
    },
  };
}
