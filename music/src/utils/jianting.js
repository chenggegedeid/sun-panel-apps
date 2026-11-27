/**
 * 简听（music-downloader）接口适配
 *
 * 与 Subsonic 的区别：
 *   - 歌曲是「曲库搜索 + 榜单 + 每日推荐」，没有专辑目录
 *   - 播放地址是临时签名地址（/api/play 返回的 proxyUrl 约 9 分钟失效）
 *     所以队列里只存歌曲对象，每次播放前重新取一次地址
 *   - 鉴权用 accessToken（2 小时），支持 ?token= 传参 —— <audio> 也能用
 *
 * 所有请求都走宿主的 api.network.request（网络透传），不使用原生 fetch。
 */
import { hostRequest, normalizeBase } from './subsonic.js';

export const JIANTING_TABS = [
  { id: 'daily', name: '每日推荐' },
  { id: 'kuwo_hot', name: '飙升榜' },
  { id: 'kuwo_new', name: '新歌榜' },
  { id: 'kuwo_top', name: 'TOP 榜' },
];

// 每个服务器一份 token 缓存（内存态，刷新页面重新登录）
const sessions = new Map();

class JiantingError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'JiantingError';
    this.status = status;
  }
}

function base(server) {
  return normalizeBase(server.url);
}

async function raw(server, path, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await hostRequest({
      request: { targetUrl: `${base(server)}${path}`, method, headers, body },
    });
  } catch (e) {
    const status = e?.response?.status;
    if (status) throw new JiantingError(`服务器返回 HTTP ${status}`, status);
    throw new JiantingError('连接失败：地址填错了，或简听服务不可达');
  }

  let data = res?.data !== undefined ? res.data : res;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new JiantingError('返回的不是 JSON，确认地址指向简听');
    }
  }
  if (data?.error) throw new JiantingError(data.error, 400);
  return data;
}

/** 登录，结果缓存在内存 */
export async function login(server, force = false) {
  const key = `${server.url}|${server.user}`;
  const hit = sessions.get(key);
  if (!force && hit && hit.exp > Date.now() + 60_000) return hit;

  if (!server.url) throw new JiantingError('还没有配置服务器');
  if (!server.user) throw new JiantingError('请填写简听的用户名和密码');

  const data = await raw(server, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: server.user, password: server.password || '' }),
  });

  const sess = {
    token: data.accessToken,
    refreshToken: data.refreshToken,
    exp: Date.now() + (data.expiresIn || 7200) * 1000,
    user: data.user,
  };
  sessions.set(key, sess);
  return sess;
}

export function clearSession(server) {
  sessions.delete(`${server.url}|${server.user}`);
}

/** 带自动重试的已授权请求 */
async function auth(server, path, opts = {}) {
  const sess = await login(server);
  try {
    return await raw(server, path, { ...opts, token: sess.token });
  } catch (e) {
    if (e.status === 401) {
      const fresh = await login(server, true);
      return raw(server, path, { ...opts, token: fresh.token });
    }
    throw e;
  }
}

/** 测试连接：登录并返回账户信息 */
export async function ping(server) {
  clearSession(server);
  const sess = await login(server, true);
  return { type: 'jianting', serverVersion: sess.user?.username || '简听', user: sess.user };
}

function mapTrack(t) {
  return {
    id: String(t.mid ?? t.id),
    mid: String(t.mid ?? t.id),
    platform: t.platform || 'kuwo',
    title: t.title || '未知歌曲',
    artist: t.artist || '',
    album: t.album || '',
    duration: Number(t.duration) || 0,
    coverArt: t.coverUrl || '',
    mediaMid: t.mediaMid || '',
    source: t.source || '',
  };
}

/** 搜索歌曲 */
export async function search(server, keyword, { platform = 'kuwo', limit = 40 } = {}) {
  const qs = new URLSearchParams({ keyword, platform, page: '1', limit: String(limit) });
  const data = await auth(server, `/api/search?${qs}`);
  return (data?.songs || []).map(mapTrack);
}

/** 首页列表：每日推荐 / 榜单 */
export async function list(server, tab = 'daily', limit = 40) {
  // 未知标签（例如切换服务类型时残留的 Subsonic 排序）一律按每日推荐处理
  if (!JIANTING_TABS.some((t) => t.id === tab)) tab = 'daily';
  if (tab === 'daily') {
    const data = await auth(server, '/api/user/recommend/daily');
    return (data?.songs || []).slice(0, limit).map(mapTrack);
  }
  const chart = JIANTING_TABS.find((t) => t.id === tab);
  if (!chart) return [];
  const qs = new URLSearchParams({ limit: String(limit) });
  const data = await auth(server, `/api/charts/${encodeURIComponent(tab)}/songs?${qs}`);
  const songs = data?.songs || data?.list || [];
  return songs.slice(0, limit).map(mapTrack);
}

/**
 * 取播放地址
 * 注意：proxyUrl 里的签名约 9 分钟失效，每次播放都必须重新申请
 */
export async function playUrl(server, track, quality = '') {
  const qs = new URLSearchParams({
    platform: track.platform || 'kuwo',
    mid: track.mid || track.id,
  });
  if (track.mediaMid) qs.set('mediaMid', track.mediaMid);
  if (track.title) qs.set('title', track.title);
  if (track.artist) qs.set('artist', track.artist);
  if (quality) qs.set('quality', quality);

  const data = await auth(server, `/api/play?${qs}`);
  const sess = sessions.get(`${server.url}|${server.user}`);
  const token = sess?.token || '';

  // 走同源代理，浏览器不需要处理防盗链头
  const path = data?.proxyUrl || '';
  if (!path) throw new JiantingError('这首歌没有可用的播放地址');
  const sep = path.includes('?') ? '&' : '?';
  return `${base(server)}${path}${sep}token=${encodeURIComponent(token)}`;
}

/** 歌词：返回 LRC 文本，没有就返回空串 */
export async function lyrics(server, track) {
  const qs = new URLSearchParams({ platform: track.platform || 'kuwo' });
  const data = await auth(
    server,
    `/api/search/lyrics/${encodeURIComponent(track.mid || track.id)}?${qs}`,
  );
  return data?.lrc || '';
}

/** 封面：曲库里一般自带 CDN 地址，没有就返回空 */
export function coverOf(track) {
  return track?.coverArt || '';
}
