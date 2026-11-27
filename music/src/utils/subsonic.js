/**
 * Subsonic / OpenSubsonic API 客户端
 * 兼容 Navidrome、Gonic、Airsonic、Jellyfin 的 Subsonic 接口
 *
 * 鉴权用 URL token（t = md5(密码 + salt)），不依赖 Cookie，
 * 所以纯前端就能跑，也不受 iframe / 第三方 Cookie 策略影响。
 */
import { md5 } from './md5.js';

const CLIENT = 'sunpanel-music';
const API_VERSION = '1.16.1';

export function uid() {
  return `m${Date.now().toString(36)}${Math.floor(Math.random() * 999).toString(36)}`;
}

/** 容错：用户可能把 /rest、网页路径 /app 或结尾斜杠一起粘进来 */
export function normalizeBase(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) {
    u = /^[\d.]+(:\d+)?(\/|$)/.test(u) ? `http://${u}` : `https://${u}`;
  }
  u = u.replace(/\/+$/, '');
  // Navidrome 的网页界面在 /app 下，接口在根路径的 /rest，误填会导致 404
  u = u.replace(/\/app$/i, '');
  u = u.replace(/\/rest$/i, '');
  return u.replace(/\/+$/, '');
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url || '');
  }
}

function randSalt() {
  return Math.random().toString(36).slice(2, 10);
}

function authQuery(server) {
  const salt = randSalt();
  const token = md5(`${server.password || ''}${salt}`);
  return `u=${encodeURIComponent(server.user || '')}&t=${token}&s=${salt}&v=${API_VERSION}&c=${CLIENT}&f=json`;
}

/** 所有请求都要带的基础参数 */
function baseParams(server) {
  const p = new URLSearchParams();
  p.set('u', server.user || '');
  const salt = randSalt();
  p.set('t', md5(`${server.password || ''}${salt}`));
  p.set('s', salt);
  p.set('v', API_VERSION);
  p.set('c', CLIENT);
  p.set('f', 'json');
  return p;
}

function buildUrl(server, endpoint, params = {}) {
  const base = normalizeBase(server.url);
  const p = baseParams(server);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  });
  return `${base}/rest/${endpoint}.view?${p.toString()}`;
}

/**
 * 请求适配器
 *
 * 按商店规范，网络请求必须走宿主提供的 api.network.request（网络透传），
 * 不要在微应用里直接用 fetch。各组件初始化时把宿主 API 注入进来。
 */
let requestAdapter = null;

export function setRequestAdapter(fn) {
  requestAdapter = typeof fn === 'function' ? fn : null;
}

export function hasRequestAdapter() {
  return !!requestAdapter;
}

export class SubsonicError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SubsonicError';
    this.code = code;
  }
}

/**
 * 调用一个 API 端点，返回 subsonic-response 内部对象
 */
export async function call(server, endpoint, params = {}) {
  if (!server || !server.url) throw new SubsonicError('还没有配置服务器');
  if (!requestAdapter) throw new SubsonicError('网络接口未就绪，请重新打开应用');

  const url = buildUrl(server, endpoint, params);

  let response;
  try {
    response = await requestAdapter({ request: { targetUrl: url, method: 'GET' } });
  } catch (e) {
    const status = e?.response?.status;
    if (status === 404) {
      throw new SubsonicError('接口 404：地址可能多了网页路径（如 /app），Subsonic 接口在域名根下的 /rest');
    }
    if (status) throw new SubsonicError(`服务器返回 HTTP ${status}`);
    // 宿主侧错误：权限不足 / 域名不在白名单 / 网络不通
    const msg = e?.response?.data?.message || e?.message || '';
    if (e?.type === 'microApp' || /permission|白名单|domain/i.test(msg)) {
      throw new SubsonicError('面板拒绝了这次请求：请确认已授予 network 权限，且该地址在域名白名单内');
    }
    throw new SubsonicError('连接失败：地址填错了，或音乐服务器不可达');
  }

  // 宿主返回 AxiosResponse 风格对象，取 data
  let data = response?.data !== undefined ? response.data : response;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new SubsonicError('服务器返回的不是有效数据，检查地址是否指向音乐服务');
    }
  }
  if (!data) {
    throw new SubsonicError('返回的不是 JSON，地址可能指向了别的服务');
  }

  const body = data['subsonic-response'];
  if (!body) throw new SubsonicError('返回格式不认识，确认地址是 Subsonic 兼容服务');

  if (body.status === 'failed') {
    const code = body.error?.code;
    const msg = body.error?.message || '请求失败';
    if (code === 40) throw new SubsonicError('用户名或密码不对', code);
    if (code === 10) throw new SubsonicError('客户端版本要求不满足', code);
    throw new SubsonicError(msg, code);
  }

  return body;
}

export async function ping(server) {
  return call(server, 'ping');
}

/** 专辑列表：newest | recent | frequent | random | alphabeticalByName */
export async function getAlbums(server, type = 'newest', size = 40, offset = 0) {
  const body = await call(server, 'getAlbumList2', { type, size, offset });
  const list = body.albumList2?.album || [];
  return list.map(normalizeAlbum);
}

export async function getAlbum(server, id) {
  const body = await call(server, 'getAlbum', { id });
  const album = body.album || {};
  const songs = (album.song || []).map(normalizeSong);
  return { album: normalizeAlbum(album), songs };
}

export async function search(server, query, counts = {}) {
  const body = await call(server, 'search3', {
    query,
    songCount: counts.songCount ?? 40,
    albumCount: counts.albumCount ?? 12,
    artistCount: 0,
  });
  const r = body.searchResult3 || {};
  return {
    albums: (r.album || []).map(normalizeAlbum),
    songs: (r.song || []).map(normalizeSong),
  };
}

/**
 * 取歌词（OpenSubsonic getLyricsBySongId，带逐行时间轴）
 * 拿不到结构化歌词时退回 getLyrics（纯文本）
 */
export async function getLyrics(server, song) {
  if (!song?.id) return null;

  try {
    const body = await call(server, 'getLyricsBySongId', { id: song.id });
    const list = body.lyricsList?.structuredLyrics || [];
    if (list.length) {
      // 优先取带时间轴的
      const pick = list.find((x) => x.synced) || list[0];
      const offset = Number(pick.offset) || 0;
      const lines = (pick.line || [])
        .map((l) => ({
          start: l.start != null ? (Number(l.start) + offset) / 1000 : null,
          text: l.value ?? l.text ?? '',
        }))
        .filter((l) => l.text !== undefined);
      if (lines.length) return { synced: !!pick.synced, lines };
    }
  } catch {
    /* 端点不存在或出错，走下面的兜底 */
  }

  try {
    const body = await call(server, 'getLyrics', {
      artist: song.artist || '',
      title: song.title || '',
    });
    const text = body.lyrics?.value;
    if (text) {
      return {
        synced: false,
        lines: String(text)
          .split(/\r?\n/)
          .map((t) => ({ start: null, text: t })),
      };
    }
  } catch {
    /* 没有就没有 */
  }

  return null;
}

/** 随机取几首歌，用于卡片直接播放时凑一个播放队列 */
export async function getRandomSongs(server, size = 30) {
  const body = await call(server, 'getRandomSongs', { size });
  const list = body.randomSongs?.song || [];
  return list.map(normalizeSong);
}

export function normalizeAlbum(a = {}) {
  return {
    id: a.id,
    name: a.name || a.title || '未知专辑',
    artist: a.artist || '',
    coverArt: a.coverArt || a.id,
    year: a.year || '',
    songCount: a.songCount || 0,
  };
}

export function normalizeSong(s = {}) {
  return {
    id: s.id,
    title: s.title || s.name || '未知歌曲',
    artist: s.artist || '',
    album: s.album || '',
    albumId: s.albumId || '',
    coverArt: s.coverArt || s.albumId || '',
    duration: s.duration || 0,
    suffix: s.suffix || '',
    bitRate: s.bitRate || 0,
  };
}

export function streamUrl(server, songId, maxBitRate = 0) {
  const p = baseParams(server);
  p.set('id', songId);
  if (maxBitRate) p.set('maxBitRate', String(maxBitRate));
  return `${normalizeBase(server.url)}/rest/stream.view?${p.toString()}`;
}

// 封面地址缓存
// baseParams 每次都生成新的随机 salt，如果不缓存，界面每帧重渲染都会得到新 URL，
// 浏览器就会不停重新下载图片 —— 表现就是封面一直闪、偶尔出现破图。
const coverUrlCache = new Map();

export function coverUrl(server, coverArtId, size = 300) {
  if (!coverArtId) return '';
  const key = `${server?.url || ''}|${coverArtId}|${size}`;
  const hit = coverUrlCache.get(key);
  if (hit) return hit;

  const p = baseParams(server);
  p.set('id', coverArtId);
  p.set('size', String(size));
  const url = `${normalizeBase(server.url)}/rest/getCoverArt.view?${p.toString()}`;

  if (coverUrlCache.size > 400) coverUrlCache.clear();
  coverUrlCache.set(key, url);
  return url;
}

/** 切换服务器后清掉旧地址（salt 与账号绑定） */
export function clearCoverCache() {
  coverUrlCache.clear();
}

export function normalizeServers(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && s.url)
    .map((s) => ({
      id: s.id || uid(),
      name: s.name || hostOf(s.url),
      url: normalizeBase(s.url),
      user: s.user || '',
      password: s.password || '',
      default: !!s.default,
    }));
}

export function activeServer(servers, activeId) {
  const list = normalizeServers(servers);
  if (!list.length) return null;
  return list.find((s) => s.id === activeId) || list.find((s) => s.default) || list[0];
}

/** 秒 → mm:ss */
export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export { authQuery };
