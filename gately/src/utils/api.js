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

function mapStatus(status, bodyMsg) {
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
      const bodyMsg = e?.response?.data?.error || '';
      if (status) throw mapStatus(status, bodyMsg);
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
        throw new GatelyError('返回的不是 JSON，地址可能指向了别的服务', { kind: 'parse' });
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
    /** 系统与各模块状态（主机 CPU / 内存 / 磁盘、版本、模块列表） */
    status: () => request('GET', '/api/status'),
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
