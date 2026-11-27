/**
 * Gately 管理 API 客户端
 *
 * 认证：管理后台「API 令牌」页建一个令牌，请求头带 Authorization: Bearer gtl_xxxx。
 * 权限：令牌只拥有创建时勾选的权限，格式 <模块>:read / <模块>:write（写包含读）。
 *
 * 按商店规范，请求走宿主提供的 api.network.request（网络透传），不在微应用里直接 fetch：
 * 这样不受浏览器跨域限制，也不用把令牌塞进页面的 fetch 请求里。
 */

let requestAdapter = null;

export function setRequestAdapter(fn) {
  requestAdapter = typeof fn === 'function' ? fn : null;
}

export function hasRequestAdapter() {
  return !!requestAdapter;
}

export class GatelyError extends Error {
  constructor(message, { status = 0, kind = 'api' } = {}) {
    super(message);
    this.name = 'GatelyError';
    this.status = status;
    this.kind = kind;
  }
}

/**
 * 规范化管理地址：
 *   - 不带协议时，有端口按 http（多半是内网 IP:16680），无端口按 https；
 *   - 去掉末尾斜杠、查询串与 hash（管理界面用 hash 路由，#/overview 之类要丢掉）；
 *   - 保留路径前缀，fnOS 统一网关那种 https://nas/app/gately 部署也能用。
 */
export function normalizeHost(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  s = s.replace(/#.*$/, '').replace(/\?.*$/, '');
  if (!/^https?:\/\//i.test(s)) {
    const hasPort = /:\d+(?:\/|$)/.test(s);
    s = `${hasPort ? 'http' : 'https'}://${s}`;
  }
  return s.replace(/\/+$/, '');
}

/** 只取主机名，用于卡片上的短标题 */
export function hostOf(url) {
  const s = normalizeHost(url);
  if (!s) return '';
  try {
    return new URL(s).host;
  } catch {
    return s.replace(/^https?:\/\//, '');
  }
}

/** 从各种可能的响应头结构里取一个头 */
function pickHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return String(Array.isArray(v) ? v[0] : v);
  }
  return '';
}

/**
 * 原样打一次请求，把底层拿到的东西全交出来。
 *
 * 排查「连上了但数据不对」时最有用：能直接看到实际请求的 URL、状态码、
 * content-type 和响应开头，不用再猜是地址错了、被反代改了，还是落到了前端页面。
 */
export async function probe(url, token = '') {
  if (!requestAdapter) {
    return { status: 0, ctype: '', snippet: '', error: '网络接口未就绪，请重新打开应用' };
  }
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const take = (res, error = '') => {
    const data = res?.data !== undefined ? res.data : res;
    let body;
    if (typeof data === 'string') body = data;
    else {
      try {
        body = JSON.stringify(data);
      } catch {
        body = String(data ?? '');
      }
    }
    return {
      status: Number(res?.status) || 0,
      ctype: pickHeader(res?.headers, 'content-type').split(';')[0].trim(),
      snippet: String(body || '').replace(/\s+/g, ' ').slice(0, 300),
      // 完整正文留给调用方判断类型用（截图里只显示开头）
      body: String(body || ''),
      error,
    };
  };
  try {
    const res = await requestAdapter({ request: { targetUrl: url, method: 'GET', headers } });
    return take(res);
  } catch (e) {
    const res = e?.response;
    const got = take(res || {}, e?.message || '');
    // 没拿到状态码，说明连请求都没发出去
    if (!got.status) got.snippet = '';
    return got;
  }
}

/**
 * 把可疑的响应压成一句人话。
 *
 * 最要紧的是分清「返回了网页」和「返回了别的 JSON」：
 * Gately 的前端是单页应用，未知路径会回退到 index.html 并返回 200，
 * 所以地址填错时拿到的不是 404，而是一个网页。
 * 带上 content-type 和页面标题，能一眼看出是被谁劫持了（运营商首页 / 路由器页 / 别的站点）。
 */
function describeBody(raw, headers) {
  const ct = pickHeader(headers, 'content-type').split(';')[0].trim();
  const tail = ct ? `，${ct}` : '';
  if (raw == null) return `返回内容为空${tail}`;
  let s;
  if (typeof raw === 'string') s = raw;
  else {
    try {
      s = JSON.stringify(raw);
    } catch {
      s = String(raw);
    }
  }
  const t = s.trim();
  if (!t) return `返回内容为空${tail}`;
  if (/^<!doctype html|^<html|<head|<body/i.test(t)) {
    const title = t.match(/<title[^>]*>([^<]{0,60})<\/title>/i);
    return title ? `返回的是网页，标题「${title[1].trim()}」${tail}` : `返回的是网页${tail}`;
  }
  return `返回内容：${t.replace(/\s+/g, ' ').slice(0, 60)}${tail}`;
}

/**
 * 判断这是不是 Sun-Panel 自己的代理错误。
 *
 * 面板的 network.request 连不上目标时，不会报网络错误，而是返回 200 +
 * {"code":-1,"data":{"sun_pan*_template_proxy_error...":"..."}}。
 * 这种响应跟 Gately 一点关系都没有，必须单独认出来，否则会被当成「地址填错」误导排查方向。
 */
function isPanelProxyError(raw) {
  if (!raw) return false;
  let blob;
  try {
    blob = typeof raw === 'string' ? raw : JSON.stringify(raw);
  } catch {
    return false;
  }
  return /sun_?pan\w*_template_proxy_error|sun_panel_proxy_error/i.test(blob || '');
}

/** 面板代理失败的统一说法 */
function proxyError(status = 200) {
  return new GatelyError(
    '面板的网络透传没能连上这台服务器（Sun-Panel 返回了自己的代理错误，不是 Gately 的响应）。'
      + '最常见的两个原因：域名只解析到 IPv6 而面板没有 IPv6 出口；或面板所在网络访问不到这个端口。'
      + '能在本机浏览器打开，不代表面板也能——先试试面板能直连的内网地址。',
    { status, kind: 'proxy' },
  );
}

function mapStatus(status, bodyMsg, raw, headers) {
  if (status === 401) {
    return new GatelyError('令牌无效或已过期，请在 Gately「API 令牌」页重新生成', { status, kind: 'auth' });
  }
  if (status === 403) {
    return new GatelyError(
      bodyMsg || '令牌缺少这项权限、该模块已关闭，或请求被 Gately 的同源校验拦下（关闭时接口返回 403）',
      { status, kind: 'scope' },
    );
  }
  if (status === 404) {
    return new GatelyError(
      bodyMsg || '接口不存在：地址可能多了网页路径，或这个模块没编译进当前版本',
      { status, kind: 'notfound' },
    );
  }
  if (status === 429) {
    return new GatelyError('请求太频繁，稍后再试', { status, kind: 'limit' });
  }
  // 200 也走到这里，说明请求成功但内容不是接口数据
  if (status >= 200 && status < 300) {
    if (isPanelProxyError(raw)) return proxyError(status);
    const info = describeBody(raw, headers);
    return new GatelyError(
      `接口返回 200，但内容不是 Gately 的接口数据（${info}）。地址没指到接口根：`
        + '经反代或子路径部署时要把路径一起写上，例如 https://nas.example.com/gately',
      { status, kind: 'parse' },
    );
  }
  if (status >= 500) {
    return new GatelyError(bodyMsg || `Gately 返回 HTTP ${status}`, { status, kind: 'server' });
  }
  return new GatelyError(bodyMsg || `Gately 返回 HTTP ${status}`, { status, kind: 'http' });
}

/**
 * 建一个客户端。
 * @param {{host:string, token:string}} conn
 */
export function createClient(conn) {
  const base = normalizeHost(conn?.host);
  const token = String(conn?.token || '').trim();

  async function request(method, path, body) {
    if (!base) throw new GatelyError('还没有填 Gately 地址', { kind: 'config' });
    if (!requestAdapter) throw new GatelyError('网络接口未就绪，请重新打开应用', { kind: 'adapter' });

    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = { targetUrl: base + path, method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      req.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await requestAdapter({ request: req });
    } catch (e) {
      const status = e?.response?.status || e?.status || 0;
      const raw = e?.response?.data;
      const headers = e?.response?.headers;
      const bodyMsg = (raw && typeof raw === 'object' && raw.error) || '';
      if (status) throw mapStatus(status, bodyMsg, raw, headers);
      const msg = e?.response?.data?.message || e?.message || '';
      if (e?.type === 'microApp' || /permission|白名单|domain/i.test(msg)) {
        throw new GatelyError('面板拒绝了这次请求：请确认已授予 network 权限，且该地址在域名白名单内', { kind: 'panel' });
      }
      throw new GatelyError('连不上 Gately：地址填错了，或管理端口没开', { kind: 'network' });
    }

    let data = res?.data !== undefined ? res.data : res;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        throw new GatelyError(
          `返回的不是 JSON（${describeBody(data)}），地址可能指向了别的服务`,
          { kind: 'parse' },
        );
      }
    }
    if (data && typeof data === 'object' && typeof data.error === 'string' && data.error) {
      throw new GatelyError(data.error, { kind: 'api' });
    }
    return data;
  }

  return {
    base,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path, body) => request('DELETE', path, body),

    /** 查看当前身份：令牌名、模块开关、只读与否 */
    session: () => request('GET', '/api/session'),
    /**
     * 系统与各模块状态（主机 CPU / 内存 / 磁盘、版本、模块列表）
     *
     * 顺带校验一下字段：地址填到别的服务上时，对方也可能 200 返回一段 JSON，
     * 与其在界面上显示一排「—」，不如当场说清楚连错地方了。
     */
    status: async () => {
      const v = await request('GET', '/api/status');
      if (!v || typeof v !== 'object' || (!v.version && !v.host)) {
        if (isPanelProxyError(v)) throw proxyError();
        throw new GatelyError(
          '这个地址响应了，但返回的字段不像 Gately。确认填的是 Gately 的管理端口（默认 16680），'
            + '不是站点域名或面板自己的地址',
          { kind: 'parse' },
        );
      }
      return v;
    },
    /** Web 服务拓扑快照：监听器、站点、QPS、带宽、上游健康 */
    topology: () => request('GET', '/api/webservice/topology'),
    /**
     * 单个站点的分钟级统计：请求 / 流量序列、状态码分布、拦截原因、前 N 个 IP / 国家
     *
     * 注意 listener 与 site 都是必填：后端按「listener+site」定位运行中的站点处理器，
     * 少传任何一个都会返回 404「站点不存在或所属监听未运行」。
     */
    stats: ({ listener, site, minutes = 30 } = {}) => {
      const qs = new URLSearchParams({
        listener: listener || '',
        site: site || '',
        minutes: String(minutes),
      });
      return request('GET', `/api/webservice/stats?${qs.toString()}`);
    },
    /** 证书列表（含到期时间、签发者、状态） */
    certs: () => request('GET', '/api/ssl/certs'),
    /** 当前封禁名单 */
    bans: () => request('GET', '/api/guard/bans'),
    /** 入侵防护与防火墙状态 */
    guardStatus: () => request('GET', '/api/guard/status'),
    /** DDNS 任务与最近同步状态 */
    ddns: () => request('GET', '/api/ddns/tasks'),
    /** 系统日志 */
    logs: (limit = 80) => request('GET', `/api/logs?limit=${limit}`),
    /** 持久化进程（frpc、tailscaled 等）资源占用 */
    processes: () => request('GET', '/api/perf/processes'),

    /** 启停一个站点 */
    setSiteEnabled: ({ listener, site }, enable) =>
      request('POST', '/api/webservice/sites/batch', {
        sites: [{ listener, site }],
        action: enable ? 'enable' : 'disable',
      }),
    /** 手动封禁 IP 或网段，seconds=0 用默认时长，-1 永久 */
    ban: (key, seconds = 0, reason = '面板手动封禁') =>
      request('POST', '/api/guard/bans', { key, seconds, reason }),
    /** 解除封禁 */
    unban: (key) => request('DELETE', '/api/guard/bans', { key }),
    /** 立即签发或续期证书 */
    renewCert: (key) => request('POST', `/api/ssl/certs/${encodeURIComponent(key)}/renew`),
    /** 立即同步一个 DDNS 任务 */
    syncDdns: (key) => request('POST', `/api/ddns/tasks/${encodeURIComponent(key)}/sync`),
  };
}
