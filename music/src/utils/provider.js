/**
 * 音乐服务注册表
 *
 * 目标：新增一种音乐服务 = 新增一个 provider 对象，不改界面代码。
 *
 * 每个 provider 需要实现（都返回统一结构）：
 *   id / label / desc        服务类型标识与展示名
 *   fields                   配置页需要填的字段（地址、账号、密码…）
 *   tabs                     首页可选列表（榜单、推荐…），没有就给空数组
 *   supportsAlbums           是否有「专辑 → 曲目」两级结构
 *   ping(server)             连接测试，返回 { type, serverVersion }
 *   list(server, {tab, keyword})
 *                            → { kind: 'albums' | 'songs', albums?, songs? }
 *   album(server, id)        → songs[]（supportsAlbums 为 false 时可不实现）
 *   play(server, song)       → 可直接给 <audio src> 的绝对地址
 *   cover(server, song, size)→ 可直接给 <img src> 的地址，没有返回 ''
 *   lyrics(server, song)     → LRC 文本，没有返回 ''
 *
 * 统一歌曲对象（Song）：
 *   { id, title, artist, album, duration, cover, platform, mid, raw }
 */

import {
  coverUrl,
  streamUrl,
  ping as subsonicPing,
  getAlbums,
  getAlbum,
  search as subsonicSearch,
  getLyrics as subsonicLyrics,
} from './subsonic.js';
import * as jt from './jianting.js';
import { parseLrc } from './lrc.js';

// ---------- Subsonic 系（Navidrome / Gonic / Airsonic / Jellyfin / 飞牛音乐） ----------
const subsonic = {
  id: 'subsonic',
  label: 'Subsonic 协议',
  desc: 'Navidrome / Gonic / Airsonic / Jellyfin / 飞牛音乐',
  supportsAlbums: true,
  fields: [
    { key: 'url', label: '地址', placeholder: 'http://192.168.1.10:4533', required: true },
    { key: 'user', label: '用户名', placeholder: '音乐服务的账号', required: true },
    { key: 'password', label: '密码', type: 'password', required: true },
  ],
  tabs: [
    { id: 'newest', name: '最新' },
    { id: 'recent', name: '最近播放' },
    { id: 'frequent', name: '最常听' },
    { id: 'alphabeticalByName', name: '按名称' },
  ],

  ping: (server) => subsonicPing(server),

  async list(server, { tab = 'newest', keyword = '' } = {}) {
    if (keyword) {
      const r = await subsonicSearch(server, keyword);
      return { kind: 'songs', songs: (r.songs || []).map(toSong) };
    }
    const albums = await getAlbums(server, tab, 60, 0);
    return { kind: 'albums', albums };
  },

  async album(server, id) {
    const a = await getAlbum(server, id);
    return (a.song || []).map(toSong);
  },

  play: (server, song) => Promise.resolve(streamUrl(server, song.id)),
  cover: (server, song, size = 300) => coverUrl(server, song?.cover || '', size),

  async lyrics(server, song) {
    const r = await subsonicLyrics(server, song?.raw || song);
    return r?.lrc || r?.text || '';
  },

  /** 结构化歌词（优先带时间轴），播放器与歌词面板共用 */
  lyricsData: (server, song) => subsonicLyrics(server, song?.raw || song),
};

function toSong(s = {}) {
  return {
    id: s.id,
    title: s.title || s.name || '未知歌曲',
    artist: s.artist || '',
    album: s.album || '',
    duration: Number(s.duration) || 0,
    cover: s.coverArt || '',
    platform: 'subsonic',
    mid: '',
    raw: s,
  };
}

// ---------- 简听（music-downloader） ----------
const jianting = {
  id: 'jianting',
  label: '简听',
  desc: 'music-downloader 自建音乐站（搜索 / 榜单 / 每日推荐）',
  supportsAlbums: false,
  fields: [
    { key: 'url', label: '地址', placeholder: 'https://music.example.com:4433', required: true },
    { key: 'user', label: '用户名', required: true },
    { key: 'password', label: '密码', type: 'password', required: true },
  ],
  tabs: jt.JIANTING_TABS,

  ping: (server) => jt.ping(server),

  async list(server, { tab = 'daily', keyword = '' } = {}) {
    const songs = keyword ? await jt.search(server, keyword) : await jt.list(server, tab);
    return { kind: 'songs', songs: songs.map(toJtSong) };
  },

  album: async () => [],

  play: (server, song) => jt.playUrl(server, song.raw || song),
  cover: (server, song) => song?.cover || '',
  lyrics: (server, song) => jt.lyrics(server, song.raw || song),

  async lyricsData(server, song) {
    return parseLrc(await jt.lyrics(server, song.raw || song));
  },
};

function toJtSong(s) {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    album: s.album,
    duration: s.duration,
    cover: s.coverArt || '',
    platform: s.platform || 'kuwo',
    mid: s.mid || s.id,
    raw: s,
  };
}

// ---------- 注册表 ----------
export const PROVIDERS = [
  subsonic,
  jianting,
  // 以后要加网易云 / QQ 音乐 / Emby / Plex / 本地目录…
  // 在这里追加一个同样结构的对象即可，界面会自动适配。
];

export function isJianting(server) {
  return (server?.type || 'subsonic') === 'jianting';
}

export function getProvider(server) {
  return PROVIDERS.find((p) => p.id === (server?.type || 'subsonic')) || subsonic;
}

export function providerMeta(type) {
  return PROVIDERS.find((p) => p.id === type) || subsonic;
}

/** 连接测试（不同服务登录方式不同，统一入口） */
export function pingServer(server) {
  return getProvider(server).ping(server);
}

export function coverFor(server, song, size = 300) {
  return getProvider(server).cover(server, song, size);
}

export function streamFor(server, song) {
  return getProvider(server).play(server, song);
}

export function listFor(server, opts) {
  return getProvider(server).list(server, opts);
}

export function albumFor(server, id) {
  return getProvider(server).album(server, id);
}

export function lyricsFor(server, song) {
  return getProvider(server).lyrics(server, song);
}

/** 结构化歌词：{ synced, lines:[{start,text}] } 或 null */
export function lyricsDataFor(server, song) {
  const p = getProvider(server);
  return p.lyricsData ? p.lyricsData(server, song) : Promise.resolve(null);
}

export function tabsFor(server) {
  return getProvider(server).tabs;
}

export function supportsAlbums(server) {
  return !!getProvider(server).supportsAlbums;
}

export { jianting };
