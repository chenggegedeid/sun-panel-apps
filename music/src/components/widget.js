import { SunPanelWidgetElement } from '@sun-panel/micro-app';
import { html, css } from 'lit';
import { buildTheme, resolveConfig } from '../utils/theme.js';
import { normalizeServers, activeServer, coverUrl, fmtTime, hostOf } from '../utils/subsonic.js';
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

  onInitialized() {
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
  _cover(size) {
    const s = this.server;
    const song = this.ps.cur;
    if (s && song?.coverArt) {
      return html`<img class="cov" style="width:${size}px;height:${size}px" src=${coverUrl(s, song.coverArt, size * 2)} alt="" />`;
    }
    return html`<div class="cov ph" style="width:${size}px;height:${size}px">♪</div>`;
  }

  _btn(kind, size = 30) {
    const map = {
      prev: { icon: '⏮', fn: (e) => this._prev(e), label: '上一首', dis: !this.ps.queue.length },
      play: { icon: this.ps.playing ? '⏸' : '▶', fn: (e) => this._toggle(e), label: '播放/暂停', dis: false },
      next: { icon: '⏭', fn: (e) => this._next(e), label: '下一首', dis: false },
    };
    const b = map[kind];
    return html`<button
      class="pb ${kind === 'play' ? 'main' : ''}"
      style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px"
      title=${b.label}
      ?disabled=${b.dis}
      @click=${b.fn}
    >
      ${b.icon}
    </button>`;
  }

  _bar(h = 3) {
    const d = this.ps.duration || 1;
    const p = Math.min(100, ((this.ps.progress || 0) / d) * 100);
    return html`<div class="bar" style="height:${h}px"><i style="width:${p}%"></i></div>`;
  }

  _title(kind = 'sm') {
    const song = this.ps.cur;
    const name = song ? song.title : this.server?.name || '音乐';
    const sub = song ? song.artist : kind === 'xs' ? '点此播放' : '点一下开始播放';
    return html`
      <div class="meta">
        <div class="tt ${kind}">${name}</div>
        <div class="st">${sub}</div>
      </div>
    `;
  }

  // ---------- 各尺寸 ----------
  render1x1() {
    const song = this.ps.cur;
    return html`
      <div class="s1" @click=${(e) => this._toggle(e)}>
        <button class="pb main" style="width:42px;height:42px;font-size:15px">
          ${this.ps.playing ? '⏸' : '▶'}
        </button>
        <div class="tt xs">${song ? song.title : '音乐'}</div>
      </div>
    `;
  }

  render1x2() {
    return html`
      <div class="s1x2">
        <div class="covwrap" @click=${() => this._open()}>${this._cover(64)}</div>
        ${this._title('xs')}
        <div class="ctrls">${this._btn('prev', 22)}${this._btn('play', 28)}${this._btn('next', 22)}</div>
      </div>
    `;
  }

  render2x1() {
    return html`
      <div class="s2x1">
        <div class="covwrap" @click=${() => this._open()}>${this._cover(44)}</div>
        <div class="grow" @click=${() => this._open()}>
          <div class="meta">
            <div class="tt sm">${this.ps.cur ? this.ps.cur.title : this.server?.name || '音乐'}</div>
          </div>
        </div>
        <div class="ctrls">${this._btn('play', 28)}${this._btn('next', 22)}</div>
      </div>
    `;
  }

  render2x2() {
    return html`
      <div class="s2x2">
        <div class="covwrap" @click=${() => this._open()}>${this._cover(86)}</div>
        <div @click=${() => this._open()}>${this._title('sm')}</div>
        <div class="ctrls">${this._btn('prev', 28)}${this._btn('play', 38)}${this._btn('next', 28)}</div>
      </div>
    `;
  }

  render2x4() {
    return html`
      <div class="s2x4">
        <div class="row">
          <div class="covwrap" @click=${() => this._open()}>${this._cover(86)}</div>
          <div class="grow" @click=${() => this._open()}>${this._title('lg')}</div>
        </div>
        <div class="prog">
          ${this._bar(4)}
          <div class="times"><span>${fmtTime(this.ps.progress)}</span><span>${fmtTime(this.ps.duration)}</span></div>
        </div>
        <div class="ctrls">${this._btn('prev', 30)}${this._btn('play', 40)}${this._btn('next', 30)}</div>
      </div>
    `;
  }

  render4x4() {
    return html`
      <div class="s4x4">
        <div class="covwrap" @click=${() => this._open()}>${this._cover(150)}</div>
        <div @click=${() => this._open()}>${this._title('xl')}</div>
        <div class="prog">
          ${this._bar(4)}
          <div class="times"><span>${fmtTime(this.ps.progress)}</span><span>${fmtTime(this.ps.duration)}</span></div>
        </div>
        <div class="ctrls">${this._btn('prev', 34)}${this._btn('play', 46)}${this._btn('next', 34)}</div>
      </div>
    `;
  }

  render1xfull() {
    const s = this.server;
    return html`
      <div class="sfull">
        <div class="covwrap" @click=${() => this._open()}>${this._cover(48)}</div>
        <div class="grow" @click=${() => this._open()}>
          <div class="tt sm">${this.ps.cur ? this.ps.cur.title : s?.name || '音乐'}</div>
          <div class="st">${this.ps.cur ? this.ps.cur.artist : hostOf(s?.url || '')}</div>
        </div>
        <div class="mid">${this._bar(3)}</div>
        <div class="times sm"><span>${fmtTime(this.ps.progress)}</span><span>${fmtTime(this.ps.duration)}</span></div>
        <div class="ctrls">${this._btn('prev', 26)}${this._btn('play', 34)}${this._btn('next', 26)}</div>
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
  `;
}
