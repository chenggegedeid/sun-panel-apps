import { html, css } from 'lit';
import { SunPanelPageElement } from '@sun-panel/micro-app';
import {
  normalizeServers,
  activeServer,
  getAlbums,
  getAlbum,
  search,
  getLyrics,
  coverUrl,
  fmtTime,
  hostOf,
  SubsonicError,
  setRequestAdapter,
} from '../utils/subsonic.js';
import {
  listFor,
  albumFor,
  lyricsFor,
  tabsFor,
  isJianting,
  coverFor,
} from '../utils/provider.js';
import { player } from '../utils/player.js';

const TABS = [
  { key: 'newest', label: '最新' },
  { key: 'recent', label: '最近播放' },
  { key: 'frequent', label: '最常听' },
  { key: 'alphabeticalByName', label: '按名称' },
];

export class MusicMain extends SunPanelPageElement {
  static properties = {
    servers: { state: true },
    activeId: { state: true },
    tab: { state: true },
    view: { state: true },
    albums: { state: true },
    album: { state: true },
    songs: { state: true },
    queue: { state: true },
    qIndex: { state: true },
    cur: { state: true },
    playing: { state: true },
    progress: { state: true },
    duration: { state: true },
    query: { state: true },
    loading: { state: true },
    error: { state: true },
  };

  constructor() {
    super();
    this.servers = [];
    this.activeId = '';
    this.tab = 'newest';
    this.view = 'albums';
    this.albums = [];
    this.album = null;
    this.songs = [];
    this.queue = [];
    this.qIndex = -1;
    this.cur = null;
    this.playing = false;
    this.progress = 0;
    this.duration = 0;
    this.query = '';
    this.loading = true;
    this.error = '';
    this.ps = player.snapshot();
    this._unsub = null;
    this.lyrics = null;
    this.showLyrics = false;
    this._lyricsFor = '';
    this._lyricIdx = -1;
    this._lyricHoldUntil = 0;
    this.dragging = false;
    this.dragValue = null;
    this._badCovers = new Set();
  }

  _shownProgress() {
    if (this.dragging && this.dragValue != null) return this.dragValue;
    return this.progress || 0;
  }

  get server() {
    return activeServer(this.servers, this.activeId);
  }

  _bindNetwork() {
    const net = this.spCtx?.api?.network;
    if (net?.request) setRequestAdapter((opts) => net.request(opts));
  }

  async onInitialized({ customParam } = {}) {
    this._bindNetwork();
    try {
      const dn = this.spCtx?.api?.dataNode?.user;
      const list = await dn?.getByKey('music', 'servers');
      const active = await dn?.getByKey('music', 'activeId');
      this.servers = normalizeServers(list);
      const want = customParam?.serverId;
      this.activeId =
        (want && this.servers.some((s) => s.id === want) ? want : '') ||
        active ||
        this.servers.find((s) => s.default)?.id ||
        this.servers[0]?.id ||
        '';
    } catch {
      this.servers = [];
    }
    this.loading = false;
    // 读回播放模式与音量
    try {
      const [m, v] = await Promise.all([
        this.spCtx?.api?.dataNode?.user?.getByKey('music', 'mode'),
        this.spCtx?.api?.dataNode?.user?.getByKey('music', 'volume'),
      ]);
      if (m === 'order' || m === 'single' || m === 'shuffle') player.mode = m;
      if (typeof v === 'number') player.setVolume(v);
    } catch {
      /* 没存过就用默认值 */
    }
    this._keyHandler = (e) => this._onKey(e);
    window.addEventListener('keydown', this._keyHandler);

    if (this.server) {
      // 服务类型不同，可用的列表标签也不同，先对齐到第一个
      const tabs = tabsFor(this.server);
      if (!tabs.some((t) => t.id === this.tab)) this.tab = tabs[0]?.id || this.tab;
      player.setServer(this.server);
      this._syncPlayer();
      this._loadAlbums();
    }
    this._unsub = player.subscribe((snap) => {
      const prevId = this.cur?.id;
      this.ps = snap;
      this.cur = snap.cur;
      this.playing = snap.playing;
      this.progress = snap.progress;
      this.duration = snap.duration;
      this.queue = snap.queue;
      this.qIndex = snap.index;
      if (snap.error) this.error = snap.error;
      // 把当前歌词行同步给播放器，卡片上也能看到
      const li = this._lineIndex();
      player.setLyricLine(li >= 0 && this.lyrics?.lines?.[li] ? this.lyrics.lines[li].text : '');
      // 只有进度在变时限流重渲染，避免整页每 240ms 重绘一次
      const sig = `${snap.cur?.id}|${snap.playing}|${snap.loading}|${snap.error}|${snap.queue.length}|${snap.index}|${snap.mode}`;
      if (sig === this._sig) {
        const now = Date.now();
        if (now - (this._lastPaint || 0) < 800) {
          this._pendingPaint = snap;
          return;
        }
        this._lastPaint = now;
      }
      this._sig = sig;

      if (snap.cur?.id !== prevId) {
        this.dragging = false;
        this.dragValue = null;
        this._lyricIdx = -1;
        this._lyricHoldUntil = 0;
        this._loadLyrics();
      }
      this.requestUpdate();
    });
  }

  // ---------- 歌词 ----------
  async _loadLyrics() {
    const song = this.cur;
    if (!song) {
      this.lyrics = null;
      this._lyricsFor = '';
      return;
    }
    const id = song.id;
    this._lyricsFor = id;
    this.lyrics = null;
    this._lyricIdx = -1;
    this.requestUpdate();
    try {
      const r = isJianting(this.server)
        ? this._parseLrc(await lyricsFor(this.server, song))
        : await getLyrics(this.server, song);
      if (this._lyricsFor === id) {
        this.lyrics = r;
        this.requestUpdate();
      }
    } catch {
      /* 没有歌词不算错误 */
    }
  }

  _lineIndex() {
    const L = this.lyrics;
    if (!L || !L.synced) return -1;
    let idx = -1;
    for (let i = 0; i < L.lines.length; i++) {
      const s = L.lines[i].start;
      if (s != null && s <= this.progress + 0.15) idx = i;
      else if (s != null) break;
    }
    return idx;
  }

  _toggleLyrics() {
    this.showLyrics = !this.showLyrics;
    if (this.showLyrics && !this.lyrics && this.cur) this._loadLyrics();
    this.requestUpdate();
    setTimeout(() => this._scrollLyric(true), 60);
  }

  _scrollLyric(force = false) {
    // 用户手动滚过歌词就暂停跟随，5 秒后再接管，避免抢滚动
    if (!force && Date.now() < this._lyricHoldUntil) return;
    const idx = this._lineIndex();
    if (!force && idx === this._lyricIdx) return;
    this._lyricIdx = idx;
    const box = this.renderRoot?.querySelector('.ly-box');
    if (!box) return;
    const el = box.querySelector('.ly-line.on');
    if (!el) return;
    box.scrollTo({
      top: Math.max(0, el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2),
      behavior: 'smooth',
    });
  }

  updated() {
    if (this.showLyrics) this._scrollLyric();
  }

  _syncPlayer() {
    const snap = player.snapshot();
    this.ps = snap;
    this.cur = snap.cur;
    this.playing = snap.playing;
    this.progress = snap.progress;
    this.duration = snap.duration;
    this.queue = snap.queue;
    this.qIndex = snap.index;
  }

  onDisconnected() {
    // 只退订，不要停音频——关窗口不该断音
    this._unsub?.();
    this._unsub = null;
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    this._keyHandler = null;
  }

  _onKey(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

    if (e.code === 'Space') {
      e.preventDefault();
      this._toggle();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey) player.seek(Math.min(player.duration || 0, player.progress + 10));
      else this._next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey) player.seek(Math.max(0, player.progress - 10));
      else this._prev();
    } else if (e.key.toLowerCase() === 'l') {
      this._toggleLyrics();
    }
  }

  _cycleMode() {
    const m = player.cycleMode();
    this.spCtx?.api?.dataNode?.user?.setByKey('music', 'mode', m).catch(() => {});
  }

  _setVolume(e) {
    const v = Number(e.target.value) / 100;
    player.setVolume(v);
    this.spCtx?.api?.dataNode?.user?.setByKey('music', 'volume', v).catch(() => {});
  }

  _modeLabel() {
    return { order: '顺', single: '单', shuffle: '随' }[this.ps?.mode || 'order'] || '顺';
  }

  _fail(e) {
    this.error = e instanceof SubsonicError ? e.message : e?.message || '出错了';
    this.requestUpdate();
  }

  async _loadAlbums() {
    if (!this.server) return;
    this.loading = true;
    this.error = '';
    try {
      const r = await listFor(this.server, { tab: this.tab });
      if (r.kind === 'albums') {
        this.albums = r.albums || [];
        this.view = 'albums';
      } else {
        this.albums = [];
        this.songs = r.songs || [];
        this.view = 'songs';
      }
    } catch (e) {
      this._fail(e);
    } finally {
      this.loading = false;
    }
  }

  async _openAlbum(id) {
    this.loading = true;
    this.error = '';
    try {
      const songs = await albumFor(this.server, id);
      this.album = this.albums.find((a) => a.id === id) || { id, name: '' };
      this.songs = songs;
      this.view = 'album';
    } catch (e) {
      this._fail(e);
    } finally {
      this.loading = false;
    }
  }

  async _doSearch() {
    const q = this.query.trim();
    if (!q) {
      this._loadAlbums();
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      const r = await listFor(this.server, { keyword: q });
      if (r.kind === 'albums') {
        this.albums = r.albums || [];
        this.songs = [];
        this.view = 'search';
      } else {
        this.albums = [];
        this.songs = r.songs || [];
        this.view = 'songs';
      }
    } catch (e) {
      this._fail(e);
    } finally {
      this.loading = false;
    }
  }

  _playFrom(list, index) {
    if (!list.length) return;
    this.error = '';
    player.playQueue(list, index, this.server);
  }

  _toggle() {
    if (!this.cur) {
      player.playAny(this.server);
      return;
    }
    player.toggle();
  }

  _next() {
    if (this.queue.length) player.next();
  }

  _prev() {
    if (this.queue.length) player.prev();
  }

  _seek(e) {
    player.seek(Number(e.target.value));
  }

  _switch(id) {
    this.activeId = id;
    this.spCtx?.api?.dataNode?.user?.setByKey('music', 'activeId', id).catch(() => {});
    this.album = null;
    this._loadAlbums();
  }

  _openSettings() {
    this.spCtx?.api?.window?.open?.({
      componentName: 'music-config',
      title: '音乐设置',
      windowConfig: { width: 760, height: 720, resize: true },
    });
  }

  _cover(coverArt, size = 300) {
    // 服务器没有这张封面时回退到占位符，避免显示浏览器的“破图”
    const u = coverArt && !this._badCovers.has(coverArt) ? coverUrl(this.server, coverArt, size) : '';
    if (!u) return html`<div class="cover ph">♪</div>`;
    return html`<img
      class="cover"
      src=${u}
      alt=""
      loading="lazy"
      @error=${() => {
    this._badCovers.add(coverArt);
    this.requestUpdate();
  }}
    />`;
  }

  // ---------- 各部分 ----------
  _topbar() {
    return html`
      <div class="bar">
        ${this.servers.length > 1
    ? html`<select class="sel" .value=${this.activeId} @change=${(e) => this._switch(e.target.value)}>
              ${this.servers.map((x) => html`<option value=${x.id} ?selected=${x.id === this.activeId}>${x.name}</option>`)}
            </select>`
    : html`<span class="srv">${this.server?.name || '音乐'}</span>`}
        <span class="host">${this.server ? hostOf(this.server.url) : ''}</span>
        <div class="search">
          <input
            .value=${this.query}
            placeholder="搜索歌曲、专辑"
            @keydown=${(e) => e.key === 'Enter' && this._doSearch()}
            @input=${(e) => (this.query = e.target.value)}
          />
          <button @click=${() => this._doSearch()}>搜索</button>
        </div>
        <button class="btn" @click=${() => this._loadAlbums()}>刷新</button>
        <button class="btn" @click=${() => this._openSettings()}>设置</button>
      </div>
    `;
  }


  /** 当前服务支持的列表标签（Subsonic 是专辑排序，简听是榜单） */
  _tabs() {
    return tabsFor(this.server).map((t) => ({ key: t.id, label: t.name }));
  }

  _songCover(song, size = 40) {
    const key = song?.id;
    const bad = key && this._badCovers.has(key);
    const u = song && !bad ? coverFor(this.server, song, size) : '';
    if (!u) return html`<div class="cover ph" style="width:${size}px;height:${size}px">♪</div>`;
    return html`<img
      class="cover"
      style="width:${size}px;height:${size}px"
      src=${u}
      alt=""
      loading="lazy"
      @error=${() => {
    this._badCovers.add(key);
    this.requestUpdate();
  }}
    />`;
  }

  /** 歌曲列表（简听这类没有专辑结构的服务用） */
  _songView() {
    const curId = this.cur?.id;
    return html`
      <div class="tabs">
        ${this._tabs().map(
    (t) => html`<button
            class="tab ${this.tab === t.key ? 'on' : ''}"
            @click=${() => {
    this.tab = t.key;
    this.query = '';
    this._loadAlbums();
  }}
          >
            ${t.label}
          </button>`,
  )}
      </div>
      <div class="songs">
        ${this.songs.map(
    (song, i) => html`<div
            class="srow ${curId === song.id ? 'on' : ''}"
            @click=${() => this._playFrom(this.songs, i)}
          >
            ${this._songCover(song, 40)}
            <div class="smeta">
              <div class="sn">${song.title}</div>
              <div class="sa">${song.artist}${song.album ? ` · ${song.album}` : ''}</div>
            </div>
            <div class="sd">${song.duration ? fmtTime(song.duration) : ''}</div>
          </div>`,
  )}
        ${!this.songs.length ? html`<div class="empty">没有找到歌曲</div>` : ''}
      </div>
    `;
  }

  /** LRC 文本 → 与结构化歌词一致的格式 */
  _parseLrc(text) {
    if (!text) return null;
    const lines = [];
    const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    let synced = false;
    for (const raw of String(text).split(/\r?\n/)) {
      const tags = [...raw.matchAll(re)];
      const content = raw.replace(re, '').trim();
      if (!tags.length) {
        if (content) lines.push({ start: null, text: content });
        continue;
      }
      synced = true;
      for (const m of tags) {
        const sec = Number(m[1]) * 60 + Number(m[2]) + Number(m[3] || 0) / 1000;
        lines.push({ start: sec, text: content });
      }
    }
    if (!lines.length) return null;
    if (synced) lines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    return { synced, lines };
  }

  _albumGrid() {
    return html`
      <div class="tabs">
        ${this._tabs().map(
    (t) => html`<button
            class="tab ${this.tab === t.key ? 'on' : ''}"
            @click=${() => {
    this.tab = t.key;
    this.query = '';
    this._loadAlbums();
  }}
          >
            ${t.label}
          </button>`,
  )}
      </div>
      <div class="grid">
        ${this.albums.map(
    (a) => html`<div class="cell" @click=${() => this._openAlbum(a.id)}>
            ${this._cover(a.coverArt, 300)}
            <div class="nm">${a.name}</div>
            <div class="ar">${a.artist || a.year || ''}</div>
          </div>`,
  )}
      </div>
      ${!this.albums.length && !this.loading ? html`<div class="empty">这个库里还没有专辑</div>` : ''}
    `;
  }

  _songList(list) {
    return html`
      <div class="songs">
        ${list.map(
    (s, i) => html`<div
            class="song ${this.cur && this.cur.id === s.id ? 'on' : ''}"
            @click=${() => this._playFrom(list, i)}
          >
            <span class="idx">${this.cur && this.cur.id === s.id && this.playing ? '♪' : i + 1}</span>
            <span class="st">${s.title}</span>
            <span class="sa">${s.artist}</span>
            <span class="sd">${fmtTime(s.duration)}</span>
          </div>`,
  )}
      </div>
    `;
  }

  _albumView() {
    return html`
      <div class="detail">
        <div class="d-left">${this._cover(this.album?.coverArt, 400)}</div>
        <div class="d-right">
          <button class="back" @click=${() => (this.view = 'albums')}>‹ 返回</button>
          <div class="d-name">${this.album?.name}</div>
          <div class="d-meta">${this.album?.artist || ''}${this.album?.year ? ` · ${this.album.year}` : ''} · ${this.songs.length} 首</div>
          <button class="playall" @click=${() => this._playFrom(this.songs, 0)}>▶ 播放全部</button>
        </div>
      </div>
      ${this._songList(this.songs)}
    `;
  }

  _searchView() {
    return html`
      <div class="sec-title">
        <span>搜索结果</span>
        <button class="back" @click=${() => this._loadAlbums()}>‹ 返回专辑</button>
      </div>
      ${this.songs.length ? this._songList(this.songs) : html`<div class="empty">没有找到歌曲</div>`}
      ${this.albums.length
    ? html`<div class="sec-title"><span>相关专辑</span></div>
            <div class="grid">
              ${this.albums.map(
    (a) => html`<div class="cell" @click=${() => this._openAlbum(a.id)}>
                  ${this._cover(a.coverArt, 300)}
                  <div class="nm">${a.name}</div>
                  <div class="ar">${a.artist || ''}</div>
                </div>`,
  )}
            </div>`
    : ''}
    `;
  }

  _lyricsPanel() {
    if (!this.showLyrics) return '';
    const L = this.lyrics;
    const idx = this._lineIndex();
    return html`
      <div class="lyrics">
        <div class="ly-head">
          <span class="ly-name">${this.cur?.title || '歌词'}</span>
          ${L ? html`<span class="ly-tag">${L.synced ? '同步' : '纯文本'}</span>` : ''}
          <button class="ly-close" @click=${() => this._toggleLyrics()}>×</button>
        </div>
        <div
          class="ly-box"
          @wheel=${() => {
    this._lyricHoldUntil = Date.now() + 5000;
  }}
          @touchmove=${() => {
    this._lyricHoldUntil = Date.now() + 5000;
  }}
        >
          ${L
    ? L.lines.map(
      (l, i) => html`<div
                  class="ly-line ${i === idx ? 'on' : ''}"
                  @click=${() => l.start != null && player.seek(l.start)}
                >
                  ${l.text || ' '}
                </div>`,
    )
    : html`<div class="ly-empty">
                ${this.cur ? '这首歌没有歌词' : '还没有在播放'}
                <span>Navidrome 需要歌曲内嵌歌词，或同目录下放同名 .lrc 文件</span>
              </div>`}
        </div>
      </div>
    `;
  }

  _playerBar() {
    const c = this.cur;
    const dur = this.duration || c?.duration || 0;
    return html`
      <div class="player">
        ${c ? this._cover(c.coverArt, 120) : html`<div class="cover ph sm">♪</div>`}
        <div class="p-info">
          <div class="p-title">${c ? c.title : '还没有在播放'}</div>
          <div class="p-artist">${c ? c.artist : '从上面的专辑里选一首'}</div>
        </div>
        <div class="p-progress">
          <span class="p-time">${fmtTime(this._shownProgress())}</span>
          <input
            class="seek ${this.dragging ? 'dragging' : ''}"
            type="range"
            min="0"
            max=${Math.max(1, Math.floor(dur))}
            .value=${String(Math.floor(this._shownProgress()))}
            @pointerdown=${() => {
    this.dragging = true;
    this.requestUpdate();
  }}
            @input=${(e) => {
    // 拖动时只更新预览值，不真的 seek，避免和 timeupdate 打架
    this.dragging = true;
    this.dragValue = Number(e.target.value);
    this.requestUpdate();
  }}
            @change=${(e) => {
    const v = Number(e.target.value);
    this.dragging = false;
    this.dragValue = null;
    player.seek(v);
    this.requestUpdate();
  }}
            @pointerup=${() => {
    // 兜底：没触发 change 也要恢复跟随
    if (this.dragging && this.dragValue == null) {
      this.dragging = false;
      this.requestUpdate();
    }
  }}
            ?disabled=${!c}
          />
          <span class="p-time">${fmtTime(dur)}</span>
        </div>
        <div class="p-ctrls">
          <button
            class="ic mode"
            title="播放模式：顺序 / 单曲 / 随机（快捷键 L 显示歌词）"
            @click=${() => this._cycleMode()}
          >
            ${this._modeLabel()}
          </button>
          <button
            class="ic lyric ${this.showLyrics ? 'on' : ''}"
            title="歌词（L）"
            @click=${() => this._toggleLyrics()}
            ?disabled=${!this.cur}
          >
            词
          </button>
          <button class="ic" title="上一首" @click=${() => this._prev()} ?disabled=${!this.queue.length}>⏮</button>
          <button class="ic big" title="播放/暂停" @click=${() => this._toggle()} ?disabled=${!c}>
            ${this.playing ? '⏸' : '▶'}
          </button>
          <button class="ic" title="下一首" @click=${() => this._next()} ?disabled=${!this.queue.length}>⏭</button>
          <input
            class="vol"
            type="range"
            min="0"
            max="100"
            .value=${String(Math.round((this.ps?.volume ?? 0.8) * 100))}
            title="音量"
            @input=${(e) => this._setVolume(e)}
          />
        </div>
      </div>
    `;
  }

  render() {
    if (this.loading && !this.albums.length && !this.album && !this.songs.length) {
      return html`<div class="wrap center"><span class="spin"></span> 正在连接…</div>`;
    }

    if (!this.server) {
      return html`
        <div class="wrap center">
          <div class="box">
            <div class="t">还没有配置音乐服务器</div>
            <div class="d">支持 Navidrome、Gonic、Airsonic、Jellyfin（Subsonic 接口）</div>
            <button class="primary" @click=${() => this._openSettings()}>去配置</button>
          </div>
        </div>
      `;
    }

    return html`
      <div class="wrap">
        ${this._topbar()}
        ${this.error ? html`<div class="err">${this.error}</div>` : ''}
        <div class="content">
          ${this.view === 'albums' ? this._albumGrid() : ''}
          ${this.view === 'album' ? this._albumView() : ''}
          ${this.view === 'search' ? this._searchView() : ''}
          ${this.view === 'songs' ? this._songView() : ''}
          ${this.loading ? html`<div class="loading"><span class="spin"></span></div>` : ''}
          ${this._lyricsPanel()}
        </div>
        ${this._playerBar()}
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
      background: #0b0d12;
      color: #e8eaf0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    .wrap {
      height: 100%;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      min-height: 0;
    }
    .wrap.center {
      align-items: center;
      justify-content: center;
      gap: 10px;
      font-size: 13px;
      color: rgba(232, 234, 240, 0.6);
    }
    .bar {
      flex: none;
      height: 46px;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 14px;
      background: #12151d;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .srv {
      font-size: 12.5px;
      font-weight: 500;
    }
    .sel {
      font-size: 12px;
      background: #1b1f29;
      color: #e8eaf0;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 7px;
      padding: 4px 8px;
      outline: none;
    }
    .host {
      font-size: 11px;
      color: rgba(232, 234, 240, 0.32);
      font-family: ui-monospace, monospace;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .search {
      flex: 1;
      display: flex;
      gap: 6px;
      max-width: 380px;
      margin-left: auto;
    }
    .search input {
      flex: 1;
      min-width: 0;
      font-size: 12px;
      padding: 6px 10px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: #1b1f29;
      color: #e8eaf0;
      outline: none;
    }
    .search input:focus {
      border-color: rgba(244, 63, 94, 0.5);
    }
    .search button,
    .btn {
      font-size: 11.5px;
      color: rgba(232, 234, 240, 0.72);
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 7px;
      padding: 5px 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn:hover,
    .search button:hover {
      color: #fff;
      border-color: rgba(255, 255, 255, 0.3);
    }
    .err {
      flex: none;
      font-size: 11.5px;
      line-height: 1.6;
      color: #fda4af;
      background: rgba(244, 63, 94, 0.12);
      padding: 7px 14px;
      border-bottom: 1px solid rgba(244, 63, 94, 0.2);
    }
    .content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 14px 16px 18px;
      position: relative;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.16) transparent;
    }
    .content::-webkit-scrollbar {
      width: 6px;
    }
    .content::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.14);
      border-radius: 6px;
    }
    .tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 12px;
    }
    .tab {
      font-size: 12px;
      padding: 5px 12px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: transparent;
      color: rgba(232, 234, 240, 0.6);
      cursor: pointer;
    }
    .tab.on {
      background: rgba(244, 63, 94, 0.16);
      border-color: rgba(244, 63, 94, 0.45);
      color: #fecdd3;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
      gap: 14px 12px;
    }
    .cell {
      cursor: pointer;
      min-width: 0;
    }
    .cell:hover .cover {
      transform: scale(1.03);
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    }
    .cover {
      width: 100%;
      aspect-ratio: 1;
      border-radius: 10px;
      object-fit: cover;
      background: #1b1f29;
      display: block;
      transition: transform 0.16s ease, box-shadow 0.16s ease;
    }
    .cover.ph {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      color: rgba(255, 255, 255, 0.18);
    }
    .cover.ph.sm {
      width: 44px;
      height: 44px;
      font-size: 18px;
      flex: none;
    }
    .nm {
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.35;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ar {
      font-size: 11px;
      color: rgba(232, 234, 240, 0.42);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .detail {
      display: flex;
      gap: 16px;
      margin-bottom: 14px;
    }
    .d-left {
      width: 148px;
      flex: none;
    }
    .d-left .cover {
      width: 148px;
      height: 148px;
    }
    .d-right {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      justify-content: center;
    }
    .d-name {
      font-size: 19px;
      font-weight: 600;
      line-height: 1.3;
    }
    .d-meta {
      font-size: 12px;
      color: rgba(232, 234, 240, 0.45);
    }
    .back {
      align-self: flex-start;
      font-size: 11.5px;
      background: transparent;
      border: none;
      color: rgba(232, 234, 240, 0.5);
      cursor: pointer;
      padding: 0;
    }
    .back:hover {
      color: #fff;
    }
    .playall {
      align-self: flex-start;
      margin-top: 4px;
      font-size: 12px;
      font-weight: 600;
      padding: 7px 16px;
      border-radius: 999px;
      border: none;
      background: #f43f5e;
      color: #fff;
      cursor: pointer;
    }
    .sec-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      font-weight: 600;
      margin: 6px 0 10px;
    }
    .songs {
      display: flex;
      flex-direction: column;
    }
    .song {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 8px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12.5px;
      min-width: 0;
    }
    .song:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    .song.on {
      background: rgba(244, 63, 94, 0.12);
      color: #fecdd3;
    }
    .idx {
      width: 20px;
      flex: none;
      text-align: center;
      font-size: 11px;
      color: rgba(232, 234, 240, 0.35);
    }
    .song.on .idx {
      color: #f43f5e;
    }
    .st {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sa {
      width: 30%;
      min-width: 0;
      font-size: 11.5px;
      color: rgba(232, 234, 240, 0.42);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sd {
      flex: none;
      font-size: 11px;
      color: rgba(232, 234, 240, 0.35);
      font-variant-numeric: tabular-nums;
    }
    .empty {
      text-align: center;
      font-size: 12.5px;
      color: rgba(232, 234, 240, 0.35);
      padding: 40px 0;
    }
    .loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(11, 13, 18, 0.55);
    }
    .spin {
      width: 15px;
      height: 15px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-top-color: #f43f5e;
      animation: sp 0.8s linear infinite;
      display: inline-block;
    }
    @keyframes sp {
      to {
        transform: rotate(360deg);
      }
    }
    /* ===== 歌词 ===== */
    .lyrics {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, #0e1118 0%, #0b0d12 100%);
      backdrop-filter: blur(10px);
      display: flex;
      flex-direction: column;
      z-index: 5;
    }
    .ly-head {
      flex: none;
      height: 40px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    }
    .ly-name {
      font-size: 12.5px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ly-tag {
      flex: none;
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(244, 63, 94, 0.16);
      color: #fda4af;
    }
    .ly-close {
      margin-left: auto;
      flex: none;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: rgba(232, 234, 240, 0.6);
      font-size: 17px;
      line-height: 1;
      cursor: pointer;
    }
    .ly-close:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }
    .ly-box {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 18px 24px 40px;
      text-align: center;
      scrollbar-width: none;
      -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 10%, #000 90%, transparent 100%);
      mask-image: linear-gradient(180deg, transparent 0, #000 10%, #000 90%, transparent 100%);
    }
    .ly-box::-webkit-scrollbar {
      width: 0;
    }
    .ly-line {
      font-size: 13.5px;
      line-height: 1.5;
      padding: 9px 0;
      color: rgba(232, 234, 240, 0.34);
      transition: color 0.2s ease, transform 0.2s ease;
      cursor: default;
      min-height: 20px;
    }
    .ly-line:hover {
      color: rgba(232, 234, 240, 0.6);
    }
    .ly-line.on {
      color: #fff;
      font-size: 15.5px;
      font-weight: 600;
      transform: scale(1.02);
    }
    .ly-empty {
      margin-top: 60px;
      font-size: 13px;
      color: rgba(232, 234, 240, 0.4);
      line-height: 2;
    }
    .ly-empty span {
      display: block;
      font-size: 11px;
      color: rgba(232, 234, 240, 0.26);
    }
    .ic.lyric {
      font-size: 11.5px;
      font-weight: 600;
      color: rgba(232, 234, 240, 0.6);
    }
    .ic.lyric.on {
      background: rgba(244, 63, 94, 0.2);
      color: #fecdd3;
    }

    .player {
      flex: none;
      height: 76px;
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 0 16px;
      background: #12151d;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
    }
    .player .cover {
      width: 48px;
      height: 48px;
      border-radius: 8px;
      flex: none;
    }
    .p-info {
      width: 190px;
      flex: none;
      min-width: 0;
    }
    .p-title {
      font-size: 12.5px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .p-artist {
      font-size: 11px;
      color: rgba(232, 234, 240, 0.42);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .p-progress {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 10.5px;
      color: rgba(232, 234, 240, 0.4);
      font-variant-numeric: tabular-nums;
    }
    .p-time {
      min-width: 36px;
      text-align: center;
    }
    .seek {
      flex: 1;
      -webkit-appearance: none;
      appearance: none;
      height: 16px;
      background: transparent;
      cursor: pointer;
      outline: none;
    }
    .seek::-webkit-slider-runnable-track {
      height: 3px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.18);
    }
    .seek::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 11px;
      height: 11px;
      margin-top: -4px;
      border-radius: 50%;
      background: #f43f5e;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .seek:hover::-webkit-slider-thumb {
      transform: scale(1.15);
      box-shadow: 0 0 0 5px rgba(244, 63, 94, 0.18);
    }
    .seek.dragging::-webkit-slider-thumb {
      transform: scale(1.25);
      box-shadow: 0 0 0 6px rgba(244, 63, 94, 0.24);
    }
    .seek::-moz-range-track {
      height: 3px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.18);
    }
    .seek::-moz-range-thumb {
      width: 11px;
      height: 11px;
      border: none;
      border-radius: 50%;
      background: #f43f5e;
    }
    .seek:disabled {
      cursor: default;
      opacity: 0.4;
    }
    .vol {
      width: 68px;
      -webkit-appearance: none;
      appearance: none;
      height: 14px;
      background: transparent;
      cursor: pointer;
      margin-left: 2px;
    }
    .vol::-webkit-slider-runnable-track {
      height: 3px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.2);
    }
    .vol::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 9px;
      height: 9px;
      margin-top: -3px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.85);
    }
    .vol::-moz-range-track {
      height: 3px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.2);
    }
    .vol::-moz-range-thumb {
      width: 9px;
      height: 9px;
      border: none;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.85);
    }
    .ic.mode {
      font-size: 11.5px;
      font-weight: 600;
      color: rgba(232, 234, 240, 0.62);
    }
    .songs {
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow-y: auto;
      padding-bottom: 8px;
    }
    .srow {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 8px;
      border-radius: 8px;
      cursor: pointer;
    }
    .srow:hover {
      background: rgba(255, 255, 255, 0.07);
    }
    .srow.on {
      background: rgba(244, 63, 94, 0.16);
    }
    .smeta {
      flex: 1;
      min-width: 0;
    }
    .sn {
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sa {
      font-size: 11.5px;
      color: rgba(232, 234, 240, 0.55);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sd {
      font-size: 11.5px;
      color: rgba(232, 234, 240, 0.45);
      font-variant-numeric: tabular-nums;
    }
    .empty {
      padding: 24px;
      text-align: center;
      font-size: 12.5px;
      color: rgba(232, 234, 240, 0.5);
    }
    .p-ctrls {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: none;
    }
    .ic {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: rgba(232, 234, 240, 0.75);
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ic:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }
    .ic.big {
      width: 38px;
      height: 38px;
      background: #f43f5e;
      color: #fff;
      font-size: 14px;
    }
    .ic.big:hover {
      background: #e11d48;
    }
    .ic:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .box {
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: center;
    }
    .box .t {
      font-size: 14px;
      font-weight: 500;
      color: #e8eaf0;
    }
    .box .d {
      font-size: 12px;
      color: rgba(232, 234, 240, 0.5);
    }
    .primary {
      margin-top: 6px;
      font-size: 12.5px;
      font-weight: 600;
      padding: 8px 20px;
      border-radius: 999px;
      border: none;
      background: #f43f5e;
      color: #fff;
      cursor: pointer;
    }
  `;
}
