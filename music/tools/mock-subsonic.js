/**
 * 开发用模拟 Subsonic 后端（只在 vite dev 生效，不会打进产物）
 *
 * 目的：在没有真实音乐服务器、也没有账号的情况下，用真实组件渲染出
 * 可用于商店展示的界面（专辑墙、曲目、歌词）。
 *
 * 路由前缀 /mock/rest：
 *   ping / getAlbumList2 / getAlbum / search3 / getLyricsBySongId / getCoverArt
 */
import { deflateSync } from 'node:zlib';

// ---------- 极简 PNG 编码 ----------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 生成一张抽象封面：双色渐变 + 几何形，模拟专辑封面 */
function makeCover(seed, size = 320) {
  const palettes = [
    [[251, 113, 133], [136, 19, 55]],
    [[56, 189, 248], [30, 58, 138]],
    [[167, 139, 250], [76, 29, 149]],
    [[52, 211, 153], [6, 78, 59]],
    [[251, 191, 36], [146, 64, 14]],
    [[244, 114, 182], [131, 24, 67]],
    [[96, 165, 250], [30, 64, 175]],
    [[148, 163, 184], [30, 41, 59]],
  ];
  const [c1, c2] = palettes[seed % palettes.length];
  const buf = Buffer.alloc(size * size * 4);
  const ang = (seed * 0.7) % Math.PI;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);

  const ringX = size * (0.3 + ((seed * 13) % 40) / 100);
  const ringY = size * (0.32 + ((seed * 7) % 30) / 100);
  const ringR = size * (0.26 + ((seed * 3) % 12) / 100);
  const triX = size * (0.62 - ((seed * 5) % 20) / 100);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.min(1, Math.max(0, ((x / size) * ca + (y / size) * sa + 1) / 2));
      let r = c1[0] + (c2[0] - c1[0]) * t;
      let g = c1[1] + (c2[1] - c1[1]) * t;
      let b = c1[2] + (c2[2] - c1[2]) * t;

      // 圆环
      const d = Math.hypot(x - ringX, y - ringY);
      if (d > ringR * 0.82 && d < ringR) {
        r = r * 0.55 + 255 * 0.45;
        g = g * 0.55 + 255 * 0.45;
        b = b * 0.55 + 255 * 0.45;
      }
      // 斜切色块
      if (x + y * 0.6 > size * 1.28 && x + y * 0.6 < size * 1.62) {
        r *= 0.82;
        g *= 0.82;
        b *= 0.82;
      }
      // 左下三角
      if (y > size * 0.72 && x + (size - y) * 0.7 > triX) {
        r = r * 0.7 + 255 * 0.3;
        g = g * 0.7 + 255 * 0.3;
        b = b * 0.7 + 255 * 0.3;
      }

      const i = (y * size + x) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = 255;
    }
  }
  return encodePng(size, size, buf);
}

// ---------- 假数据 ----------
const ARTISTS = ['Lorde', '陈奕迅', '坂本龍一', 'The Weeknd', '李志', 'Daft Punk', '王菲', 'Radiohead'];
const ALBUMS = [
  { id: 'a1', name: 'Melodrama', artist: 'Lorde', year: 2017 },
  { id: 'a2', name: '认了吧', artist: '陈奕迅', year: 2007 },
  { id: 'a3', name: 'async', artist: '坂本龍一', year: 2017 },
  { id: 'a4', name: 'After Hours', artist: 'The Weeknd', year: 2020 },
  { id: 'a5', name: '1701', artist: '李志', year: 2014 },
  { id: 'a6', name: 'Random Access Memories', artist: 'Daft Punk', year: 2013 },
  { id: 'a7', name: '寓言', artist: '王菲', year: 2000 },
  { id: 'a8', name: 'In Rainbows', artist: 'Radiohead', year: 2007 },
];

const SONG_NAMES = {
  a1: ['Green Light', 'Sober', 'The Louvre', 'Liability', 'Perfect Places'],
  a2: ['富士山下', '好久不见', '不如不见', '白色球鞋', '淘汰'],
  a3: ['andata', 'disintegration', 'solari', 'ZURE', 'walker'],
  a4: ['Blinding Lights', 'Save Your Tears', 'In Your Eyes', 'Faith', 'Alone Again'],
  a5: ['关于郑州的记忆', '热河', '天空之城', '山阴路的夏天', '你离开了南京'],
  a6: ['Get Lucky', 'Instant Crush', 'Lose Yourself to Dance', 'Giorgio by Moroder', 'Doin\' it Right'],
  a7: ['寓言', '当时的月亮', '只爱陌生人', '催眠', '彼岸花'],
  a8: ['15 Step', 'Nude', 'Weird Fishes', 'All I Need', 'Videotape'],
};

const LYRIC_LINES = [
  [0, ''],
  [12.4, '夏天的下午 你在我身边'],
  [16.8, '风把窗帘吹起来'],
  [21.2, '我们什么也没说'],
  [25.6, '只是听着这首歌'],
  [30.0, '那时候以为时间很慢'],
  [34.5, '慢到可以一直这样'],
  [39.0, '后来才知道'],
  [43.5, '那是我们最好的日子'],
  [48.0, '有些话没说出口'],
  [52.5, '就一直没说出口'],
  [57.0, '再听见这首歌的时候'],
  [61.5, '已经是很多年以后了'],
];

function songsOf(albumId) {
  const album = ALBUMS.find((a) => a.id === albumId) || ALBUMS[0];
  const names = SONG_NAMES[albumId] || ['Track 1', 'Track 2'];
  return names.map((n, i) => ({
    id: `${albumId}-s${i + 1}`,
    title: n,
    artist: album.artist,
    album: album.name,
    albumId: album.id,
    coverArt: album.id,
    duration: 180 + ((i * 37) % 120),
    suffix: 'flac',
    bitRate: 900,
  }));
}

function albumJson(a, i) {
  return {
    id: a.id,
    name: a.name,
    artist: a.artist,
    coverArt: a.id,
    year: a.year,
    songCount: (SONG_NAMES[a.id] || []).length,
    created: `2026-0${(i % 9) + 1}-1${i % 9}T10:00:00Z`,
  };
}

// ---------- 插件 ----------
export function mockSubsonic() {
  const coverCache = new Map();

  return {
    name: 'mock-subsonic',
    configureServer(server) {
      server.middlewares.use('/mock/rest', (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const ep = url.pathname.replace(/^\//, '').replace(/\.view$/, '');
        const q = url.searchParams;
        const send = (obj) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...obj } }));
        };

        if (ep === 'getCoverArt') {
          const id = q.get('id') || 'a1';
          const seed = Math.abs([...id].reduce((s, ch) => s + ch.charCodeAt(0), 0));
          if (!coverCache.has(id)) coverCache.set(id, makeCover(seed));
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=600');
          res.end(coverCache.get(id));
          return;
        }

        if (ep === 'ping') return send({ type: 'navidrome', serverVersion: '0.61.2' });

        if (ep === 'getAlbumList2') {
          return send({ albumList2: { album: ALBUMS.map(albumJson) } });
        }

        if (ep === 'getAlbum') {
          const id = q.get('id') || 'a1';
          const a = ALBUMS.find((x) => x.id === id) || ALBUMS[0];
          return send({ album: { ...albumJson(a, 0), song: songsOf(a.id) } });
        }

        if (ep === 'search3') {
          return send({
            searchResult3: {
              album: ALBUMS.slice(0, 4).map(albumJson),
              song: songsOf('a1').slice(0, 3),
            },
          });
        }

        if (ep === 'getRandomSongs') {
          return send({ randomSongs: { song: songsOf('a1') } });
        }

        if (ep === 'getLyricsBySongId') {
          return send({
            lyricsList: {
              structuredLyrics: [
                {
                  lang: 'zh',
                  synced: true,
                  line: LYRIC_LINES.map(([start, value]) => ({ start: start * 1000, value })),
                },
              ],
            },
          });
        }

        if (ep === 'stream') {
          res.statusCode = 204;
          return res.end();
        }

        next();
      });
    },
  };
}
