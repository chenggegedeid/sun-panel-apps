import { SunPanelWidgetElement } from '@sun-panel/micro-app';
import { html, css } from 'lit';
import { buildTheme, resolveConfig } from '../utils/theme.js';
import { normalizeServers, activeServer, fmtTime,
  setRequestAdapter,
} from '../utils/subsonic.js';
import { coverFor } from '../utils/provider.js';
import { player } from '../utils/player.js';

export class MusicWidget extends SunPanelWidgetElement {
  static properties = {
    servers: { state: true },
    settings: { state: true },
    activeId: { state: true },
    ready: { state: true },
    ps: { state: true },
  };

  constructor() {
    super();
    this._badCovers = new Set();
    this.servers = [];
    this.settings = null;
    this.activeId = '';
    this.ready = false;
    this.ps = player.snapshot();
    this._unsub = null;
  }

  get cfg() {
    return resolveConfig({ ...(this.spCtx?.widgetInfo?.config || {}), ...(this.settings || {}) });
  }

  get server() {
    return activeServer(this.servers, this.activeId || this.cfg.activeId);
  }

  _bindNetwork() {
    const net = this.spCtx?.api?.network;
    if (net?.request) setRequestAdapter((opts) => net.request(opts));
  }

  onInitialized() {
    this._bindNetwork();
    this._load();
    this._unsub = player.subscribe((snap) => {
      this.ps = snap;
      this.requestUpdate();
    });
  }

  onWidgetInfoChanged() {
    this._load();
    this.requestUpdate();
  }

  onDisconnected() {
    this._unsub?.();
    this._unsub = null;
  }

  async _load() {
    try {
      const dn = this.spCtx?.api?.dataNode?.user;
      const list = await dn?.getByKey('music', 'servers');
      const active = await dn?.getByKey('music', 'activeId');
      const settings = await dn?.getByKey('music', 'settings');
      this.servers = normalizeServers(list);
      this.activeId = active || '';
      if (settings) this.settings = settings;
    } catch {
      this.servers = [];
    }
    this.ready = true;
    const s = this.server;
    if (s) player.setServer(s);
    this.ps = player.snapshot();
  }

  // ---------- 行为 ----------
  _toggle(e) {
    e?.stopPropagation();
    const s = this.server;
    if (!s) {
      this._open();
      return;
    }
    if (player.cur) player.toggle();
    else player.playAny(s);
  }

  _next(e) {
    e?.stopPropagation();
    if (player.queue.length) player.next();
    else player.playAny(this.server);
  }

  _prev(e) {
    e?.stopPropagation();
    player.prev();
  }

  _open() {
    const s = this.server;
    if (!s) {
      this.spCtx?.api?.window?.open?.({
        componentName: 'music-config',
        title: '音乐设置',
        windowConfig: { width: 760, height: 720, resize: true },
      });
      return;
    }
    this.spCtx?.api?.window?.open?.({
      componentName: 'music-main',
      title: s.name || '音乐',
      customParam: { serverId: s.id },
      windowConfig: {
        width: 1080,
        height: 720,
        resize: true,
        showFullscreenBtn: true,
        background: '#0b0d12',
        backgroundDark: '#0b0d12',
      },
    });
  }

  // ---------- 片段 ----------
  _icon(kind, size) {
    const w = Math.round(size * 0.4);
    if (kind === 'play') {
      return html`<svg width="${w}" height="${w + 2}" viewBox="0 0 11 12"><path d="M1 1l9 5-9 5z" fill="currentColor"/></svg>`;
    }
    if (kind === 'pause') {
      return html`<svg width="${w}" height="${w}" viewBox="0 0 10 12">
        <rect x="0" y="0" width="3.2" height="12" rx="1.2" fill="currentColor"/>
        <rect x="6.8" y="0" width="3.2" height="12" rx="1.2" fill="currentColor"/>
      </svg>`;
    }
    if (kind === 'next') {
      return html`<svg width="${w}" height="${w}" viewBox="0 0 11 11">
        <path d="M1 0.6l7 4.9L1 10.4z" fill="currentColor"/>
        <rect x="9" y="0.6" width="1.8" height="9.8" rx="0.9" fill="currentColor"/>
      </svg>`;
    }
    return html`<svg width="${w}" height="${w}" viewBox="0 0 11 11">
      <path d="M10 0.6L3 5.5 10 10.4z" fill="currentColor"/>
      <rect x="0.2" y="0.6" width="1.8" height="9.8" rx="0.9" fill="currentColor"/>
    </svg>`;
  }

  _btn(kind, size = 30) {
    const map = {
      prev: { fn: (e) => this._prev(e), label: '上一首', dis: !this.ps.queue.length },
      play: { fn: (e) => this._toggle(e), label: '播放/暂停', dis: false },
      next: { fn: (e) => this._next(e), label: '下一首', dis: false },
    };
    const b = map[kind];
    const glyph = kind === 'play' && this.ps.playing ? 'pause' : kind;
    return html`<button
      class="pb ${kind === 'play' ? 'main' : ''}"
      style="width:${size}px;height:${size}px;background:rgba(255,255,255,${kind === 'play' ? 0.24 : 0.16});border:none;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)"
      title=${b.label}
      ?disabled=${b.dis}
      @click=${b.fn}
    >
      ${this._icon(glyph, size)}
    </button>`;
  }

  /** 封面平均亮度，用来决定遮罩深浅（0 暗 / 1 亮） */
  _lum() {
    const id = this.ps.cur?.id;
    return (id && this._lumCache?.get(id)) ?? 0.35;
  }

  _measureLum(img, id) {
    if (!img || !id || this._lumCache?.has(id)) return;
    try {
      const c = document.createElement('canvas');
      c.width = 12;
      c.height = 12;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 12, 12);
      const d = g.getImageData(0, 0, 12, 12).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      }
      if (!this._lumCache) this._lumCache = new Map();
      this._lumCache.set(id, sum / (d.length / 4));
      this.requestUpdate();
    } catch {
      /* 跨域图片取不到像素，用默认值 */
    }
  }

  /** 铺满整卡的封面 + 渐变遮罩 */
  _bg(vertical = true) {
    const song = this.ps.cur;
    const url = this.server && song ? coverFor(this.server, song, 600) : '';
    const dark = this._lum() > 0.62 ? 0.82 : 0.68;
    // 横向卡片文字都在左侧，遮罩必须左深右浅，否则标题压在亮部看不清
    const grad = vertical
      ? `linear-gradient(180deg, rgba(0,0,0,0) 28%, rgba(0,0,0,${(dark - 0.2).toFixed(2)}) 62%, rgba(0,0,0,${dark}) 100%)`
      : `linear-gradient(90deg, rgba(0,0,0,${dark}) 0%, rgba(0,0,0,${(dark - 0.18).toFixed(2)}) 55%, rgba(0,0,0,${(dark - 0.3).toFixed(2)}) 100%)`;
    return html`
      ${url
    ? html`<img
            src=${url}
            alt=""
            style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
            @load=${(e) => this._measureLum(e.target, this.ps.cur?.id)}
            @error=${() => {
    this._badCovers.add(this.ps.cur?.id);
    this.requestUpdate();
  }}
          />`
    : html`<div style="position:absolute;inset:0;background:rgba(120,120,140,0.25)"></div>`}
      <div style="position:absolute;inset:0;background:${grad}"></div>
    `;
  }

  _lyric(size = 11.5, max = 1) {
    const t = this.ps.lyricLine;
    if (!t) return '';
    return html`<div style="font-size:${size}px;color:rgba(255,255,255,0.58);margin-top:6px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:${max};-webkit-box-orient:vertical;overflow:hidden">${t}</div>`;
  }

  _progBottom(h = 2) {
    const d = this.ps.duration || 1;
    const p = Math.min(100, ((this.ps.progress || 0) / d) * 100);
    return html`<div style="position:absolute;left:0;right:0;bottom:0;height:${h}px;background:rgba(255,255,255,0.18)">
      <div style="width:${p}%;height:100%;background:rgba(255,255,255,0.9)"></div>
    </div>`;
  }

  // ---------- 各尺寸 ----------
  render1x1() {
    const song = this.ps.cur;
    const art = this.server && song ? coverFor(this.server, song, 160) : '';
    return html`
      <div class="s1" @click=${() => this._open()}>
        ${art ? html`<img class="s1art" src=${art} alt="" />` : ''}
        <button class="pb main s1pb" title="播放/暂停" @click=${(e) => this._toggle(e)}>
          ${this._icon(this.ps.playing ? 'pause' : 'play', 40)}
        </button>
        <div class="tt xs">${song ? song.title : '音乐'}</div>
      </div>
    `;
  }

  render1x2() {
    const cur = this.ps.cur;
    return html`
      <div style="position:relative;width:100%;height:100%;overflow:hidden;border-radius:inherit" @click=${() => this._open()}>
        ${this._bg(true)}
        <div style="position:absolute;left:0;right:0;bottom:0;padding:9px 10px 12px">
          <div style="font-size:12.5px;font-weight:500;color:#fff;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${cur ? cur.title : this.server?.name || '音乐'}
          </div>
          <div style="font-size:10.5px;color:rgba(255,255,255,0.72);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${cur ? cur.artist : '点此播放'}
          </div>
          ${this._lyric(10.5, 2)}
          <div style="display:flex;gap:6px;margin-top:9px">
            ${this._btn('play', 27)}${this._btn('next', 21)}
          </div>
        </div>
        ${this._progBottom(2)}
      </div>
    `;
  }

  render2x1() {
    const cur = this.ps.cur;
    const art = this.server && cur ? coverFor(this.server, cur, 140) : '';
    return html`
      <div class="row21" @click=${() => this._open()}>
        ${this._bg(false)}
        <div class="fullart sm">
          ${art ? html`<img src=${art} alt="" />` : html`<span>♪</span>`}
        </div>
        <div class="fulltxt">
          <div class="fulltt">
            <span class="n">${cur ? cur.title : this.server?.name || '音乐'}</span>
            ${cur && cur.artist ? html`<span class="a">${cur.artist}</span>` : ''}
          </div>
          <div class="fullsub">${this.ps.lyricLine || (cur ? cur.album || '正在播放' : '点一下开始播放')}</div>
        </div>
        <div class="ctl21">
          ${this._btn('play', 30)}${this._btn('next', 22)}
        </div>
        ${this._progBottom(2)}
      </div>
    `;
  }

  render2x2() {
    const cur = this.ps.cur;
    return html`
      <div style="position:relative;width:100%;height:100%;overflow:hidden;border-radius:inherit" @click=${() => this._open()}>
        ${this._bg(true)}
        <div style="position:absolute;left:0;right:0;bottom:0;padding:12px 14px 15px">
          <div style="font-size:14px;font-weight:500;color:#fff;line-height:1.28;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${cur ? cur.title : this.server?.name || '音乐'}
          </div>
          <div style="font-size:11.5px;color:rgba(255,255,255,0.72);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${cur ? cur.artist : '点一下开始播放'}
          </div>
          ${this._lyric(11.5, 2)}
          <div style="display:flex;gap:8px;margin-top:11px;align-items:center">
            ${this._btn('prev', 26)}${this._btn('play', 34)}${this._btn('next', 26)}
          </div>
        </div>
        ${this._progBottom(2)}
      </div>
    `;
  }

  /** 大字歌词：2x4 用 */
  render2x4() {
    const cur = this.ps.cur;
    const url = this.server && cur ? coverFor(this.server, cur, 600) : '';
    return html`
      <div style="position:relative;width:100%;height:100%;overflow:hidden;border-radius:inherit" @click=${() => this._open()}>
        ${url
    ? html`<img src=${url} alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(30px) brightness(0.5) saturate(1.25);transform:scale(1.35)" />`
    : ''}
        <div style="position:absolute;inset:0;background:rgba(8,8,12,0.34)"></div>
        <div style="position:absolute;left:22px;top:16px;font-size:10.5px;letter-spacing:0.08em;color:rgba(255,255,255,0.5)">NOW PLAYING</div>
        <div style="position:absolute;left:22px;right:22px;top:50%;transform:translateY(-56%)">
          <div style="font-size:27px;font-weight:500;color:#fff;line-height:1.45;letter-spacing:0.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">
            ${this.ps.lyricLine || (cur ? cur.title : '点一下开始播放')}
          </div>
          <div style="font-size:12px;color:rgba(255,255,255,0.38);margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${cur ? `${cur.title} · ${cur.artist}` : ''}
          </div>
        </div>
        <div style="position:absolute;left:22px;right:22px;bottom:18px;display:flex;align-items:center;gap:11px">
          ${this._btn('play', 26)}
          <div style="flex:1;height:2px;background:rgba(255,255,255,0.18);border-radius:2px">
            <div style="width:${Math.min(100, ((this.ps.progress || 0) / (this.ps.duration || 1)) * 100)}%;height:100%;background:rgba(255,255,255,0.85);border-radius:2px"></div>
          </div>
          <div style="font-size:10.5px;color:rgba(255,255,255,0.55);flex:none;font-variant-numeric:tabular-nums">
            ${fmtTime(this.ps.progress)} / ${fmtTime(this.ps.duration)}
          </div>
        </div>
      </div>
    `;
  }

  /** 大字歌词：4x4 用，多一行预备歌词 */
  render4x4() {
    const cur = this.ps.cur;
    const url = this.server && cur ? coverFor(this.server, cur, 600) : '';
    return html`
      <div style="position:relative;width:100%;height:100%;overflow:hidden;border-radius:inherit" @click=${() => this._open()}>
        ${url
    ? html`<img src=${url} alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(34px) brightness(0.45) saturate(1.3);transform:scale(1.4)" />`
    : ''}
        <div style="position:absolute;inset:0;background:rgba(8,8,12,0.34)"></div>
        <div style="position:absolute;left:30px;top:26px;font-size:11px;letter-spacing:0.1em;color:rgba(255,255,255,0.45)">NOW PLAYING</div>
        <div style="position:absolute;left:30px;right:30px;top:50%;transform:translateY(-54%)">
          <div style="font-size:34px;font-weight:500;color:#fff;line-height:1.42;letter-spacing:0.01em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">
            ${this.ps.lyricLine || (cur ? cur.title : '点一下开始播放')}
          </div>
          <div style="font-size:13px;color:rgba(255,255,255,0.36);margin-top:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${cur ? `${cur.title} · ${cur.artist}` : ''}
          </div>
        </div>
        <div style="position:absolute;left:30px;right:30px;bottom:26px;display:flex;align-items:center;gap:12px">
          ${this._btn('prev', 24)}${this._btn('play', 34)}${this._btn('next', 24)}
          <div style="flex:1;height:2px;background:rgba(255,255,255,0.18);border-radius:2px;margin-left:4px">
            <div style="width:${Math.min(100, ((this.ps.progress || 0) / (this.ps.duration || 1)) * 100)}%;height:100%;background:rgba(255,255,255,0.85);border-radius:2px"></div>
          </div>
        </div>
      </div>
    `;
  }

  render1xfull() {
    const cur = this.ps.cur;
    const s = this.server;
    const art = s && cur ? coverFor(s, cur, 200) : '';
    // 极扁的横幅上 object-fit:cover 只会裁出一条放大的碎块，靠模糊虚化压成底色
    const bgUrl = s && cur ? coverFor(s, cur, 600) : '';
    const d = this.ps.duration || 1;
    const p = Math.min(100, ((this.ps.progress || 0) / d) * 100);
    const sub = this.ps.lyricLine || (cur ? cur.album || '正在播放' : '点一下开始播放');
    return html`
      <div class="full" @click=${() => this._open()}>
        ${bgUrl ? html`<img class="fullbg" src=${bgUrl} alt="" />` : ''}
        <div class="fullscrim"></div>
        <div class="fullart">
          ${art ? html`<img src=${art} alt="" />` : html`<span>♪</span>`}
        </div>
        <div class="fullhead">
          <span class="n">${cur ? cur.title : s?.name || '音乐'}</span>
          <span class="a">${cur ? cur.artist || '' : ''}</span>
        </div>
        <div class="fullyric">${sub}</div>
        <div class="fullside">
          <span class="fulltime">${fmtTime(this.ps.progress)} / ${fmtTime(this.ps.duration)}</span>
          ${this._btn('prev', 26)}${this._btn('play', 32)}${this._btn('next', 26)}
        </div>
        <div class="fullbar"><i style="width:${p}%"></i></div>
      </div>
    `;
  }

  render() {
    const size = this.spCtx?.widgetInfo?.gridSize || '1x1';
    const theme = buildTheme(this.cfg, this.spCtx?.darkMode);
    const isTransparent = theme.cfg.bgMode === 'transparent';

    const containerStyle = [
      theme.surface,
      `color:${theme.text}`,
      `border-radius:${theme.radius}px`,
      `border:${theme.border}`,
      `box-shadow:${isTransparent ? 'none' : theme.shadow}`,
      `text-shadow:${isTransparent ? theme.textShadow : 'none'}`,
      `--soft:${theme.sub}`,
      `--faint:${theme.faint}`,
      `--accent:${theme.accent}`,
      `--hairline:${theme.hairline}`,
    ].join(';');

    if (!this.ready) {
      return html`<div class="container" style="${containerStyle}"><div class="empty">载入中…</div></div>`;
    }
    if (!this.server) {
      return html`<div class="container" style="${containerStyle}" @click=${() => this._open()}>
        <div class="empty">还没有添加服务器<span>点这里配置</span></div>
      </div>`;
    }

    const body = {
      '1x1': () => this.render1x1(),
      '1x2': () => this.render1x2(),
      '2x1': () => this.render2x1(),
      '2x2': () => this.render2x2(),
      '2x4': () => this.render2x4(),
      '4x4': () => this.render4x4(),
      '1xfull': () => this.render1xfull(),
    }[size];

    return html`<div class="container size-${size}" style="${containerStyle}">
      ${body ? body() : this.render1x1()}
    </div>`;
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
      background: transparent;
    }
    .container {
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      padding: 9px 11px;
      display: flex;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      background-color: transparent;
      -webkit-font-smoothing: antialiased;
    }
    .container > div {
      width: 100%;
    }
    .cov {
      border-radius: 9px;
      object-fit: cover;
      display: block;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
    }
    .cov.ph {
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(127, 127, 127, 0.18);
      color: var(--faint);
      font-size: 22px;
      box-shadow: none;
    }
    .covwrap {
      line-height: 0;
      flex: none;
      cursor: pointer;
      transition: transform 0.15s ease;
    }
    .covwrap:hover {
      transform: scale(1.02);
    }
    .grow {
      flex: 1;
      min-width: 0;
      cursor: pointer;
    }
    .meta {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .tt {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }
    .tt.xs {
      font-size: 10.5px;
    }
    .tt.sm {
      font-size: 12.5px;
    }
    .tt.lg {
      font-size: 14.5px;
    }
    .tt.xl {
      font-size: 16px;
    }
    .lrc {
      margin-top: 3px;
      font-size: 11px;
      line-height: 1.35;
      color: rgba(255, 255, 255, 0.55);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .st {
      font-size: 10.5px;
      color: var(--faint);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pb {
      border-radius: 50%;
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      opacity: 0.82;
      transition: opacity 0.14s ease, background 0.14s ease, transform 0.14s ease;
      flex: none;
    }
    .pb:hover {
      opacity: 1;
      background: rgba(127, 127, 127, 0.16);
    }
    .pb:active {
      transform: scale(0.94);
    }
    .pb:disabled {
      opacity: 0.3;
      cursor: default;
      background: transparent;
    }
    .pb.main {
      background: var(--accent);
      color: #fff;
      opacity: 1;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }
    .pb.main:hover {
      background: var(--accent);
      filter: brightness(1.06);
    }
    .ctrls {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: none;
    }
    .bar {
      width: 100%;
      border-radius: 999px;
      background: rgba(127, 127, 127, 0.28);
      overflow: hidden;
    }
    .bar i {
      display: block;
      height: 100%;
      background: var(--accent);
      border-radius: 999px;
      transition: width 0.2s linear;
    }
    .prog {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin: 6px 0 2px;
    }
    .times {
      display: flex;
      justify-content: space-between;
      font-size: 9.5px;
      color: var(--faint);
      font-variant-numeric: tabular-nums;
    }
    .times.sm {
      flex: none;
      gap: 4px;
      font-size: 9.5px;
      width: 74px;
      justify-content: flex-end;
    }
    .mid {
      flex: 1;
      min-width: 20px;
      margin: 0 4px;
    }
    .empty {
      margin: auto;
      text-align: center;
      font-size: 11px;
      line-height: 1.7;
      color: var(--soft);
    }
    .empty span {
      display: block;
      font-size: 10.5px;
      color: var(--faint);
    }

    .s1 {
      margin: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      text-align: center;
      height: 100%;
      cursor: pointer;
    }
    .s1x2 {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 7px;
      text-align: center;
    }
    .s1x2 .ctrls {
      gap: 4px;
    }
    .s2x1 {
      height: 100%;
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
    }
    .s2x1 .ctrls {
      gap: 2px;
    }
    .s2x2 {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      text-align: center;
    }
    .s2x2 .meta {
      align-items: center;
    }
    .s2x4 {
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 4px;
    }
    .s2x4 .row {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .s4x4 {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      text-align: center;
    }
    .s4x4 .meta {
      align-items: center;
    }
    .s4x4 .prog {
      width: 78%;
    }
    .sfull {
      height: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    /* ---------- 1xfull / 2x1 共用：通栏横幅 ---------- */
    .container.size-1xfull,
    .container.size-1x1,
    .container.size-2x1 {
      padding: 0;
    }
    .full,
    .row21 {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      border-radius: inherit;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .full {
      padding: 0 14px 2px;
    }
    .row21 {
      padding: 0 11px 2px;
      gap: 10px;
    }
    .fullbg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: blur(26px) saturate(1.3) brightness(0.6);
      transform: scale(1.4);
    }
    .fullscrim {
      position: absolute;
      inset: 0;
      background: linear-gradient(
        90deg,
        rgba(0, 0, 0, 0.66) 0%,
        rgba(0, 0, 0, 0.4) 46%,
        rgba(0, 0, 0, 0.52) 100%
      );
    }
    .fullart {
      position: relative;
      flex: none;
      height: calc(100% - 14px);
      max-height: 74px;
      aspect-ratio: 1 / 1;
      border-radius: 8px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.12);
      box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 17px;
      color: rgba(255, 255, 255, 0.7);
    }
    .fullart.sm {
      max-height: 56px;
      border-radius: 7px;
      font-size: 14px;
    }
    .fullart img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .fulltxt {
      position: relative;
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
    }
    .fullhead {
      position: relative;
      flex: 0 1 auto;
      min-width: 0;
      max-width: 34%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1px;
    }
    .fullhead .n {
      font-size: 13.5px;
      font-weight: 500;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .fullhead .a {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.58);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .fullyric {
      position: relative;
      flex: 1 1 auto;
      min-width: 0;
      padding-left: 16px;
      font-size: 12px;
      line-height: 1.4;
      color: rgba(255, 255, 255, 0.56);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .fulltt {
      display: flex;
      align-items: baseline;
      gap: 7px;
      min-width: 0;
    }
    .fulltt .n {
      flex: 0 1 auto;
      min-width: 0;
      font-size: 13.5px;
      font-weight: 500;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .fulltt .a {
      flex: 0 1 auto;
      min-width: 0;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.6);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .fullsub {
      font-size: 11px;
      line-height: 1.4;
      color: rgba(255, 255, 255, 0.5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .fullside {
      position: relative;
      flex: none;
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .fulltime {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.45);
      font-variant-numeric: tabular-nums;
      margin-right: 2px;
      white-space: nowrap;
    }
    .fullbar {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 2px;
      background: rgba(255, 255, 255, 0.16);
    }
    .fullbar i {
      display: block;
      height: 100%;
      background: rgba(255, 255, 255, 0.85);
    }
    .ctl21 {
      position: relative;
      flex: none;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    /* 1x1：封面当底，中间一颗播放键 */
    .s1 {
      position: relative;
      border-radius: inherit;
      padding: 0 6px;
      box-sizing: border-box;
    }
    .s1art {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: blur(18px) brightness(0.55) saturate(1.3);
      transform: scale(1.25);
      border-radius: inherit;
    }
    .s1pb {
      position: relative;
      width: 40px;
      height: 40px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32);
    }
    .s1 .tt {
      position: relative;
      max-width: 100%;
      padding: 0 4px;
      color: #fff;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    }
  `;
}
