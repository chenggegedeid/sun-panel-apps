/**
 * 全局播放器（模块级单例）
 *
 * 为什么不用组件内的 <audio>：
 * 卡片和窗口是两个独立组件，把 audio 放在某个组件里，组件销毁音频就没了。
 * 放在模块作用域，只要面板页面没刷新，音乐就一直在放——
 * 关掉播放窗口不会中断，多张卡片看到的是同一个播放状态。
 */
import { streamUrl, getRandomSongs, coverUrl } from './subsonic.js';

class Player {
  constructor() {
    this._audio = null;
    this._listeners = new Set();
    this.queue = [];
    this.index = -1;
    this.server = null;
    this.loading = false;
    this.error = '';
    this._lastEmit = 0;
  }

  get cur() {
    return this.queue[this.index] || null;
  }

  get playing() {
    return !!this._audio && !this._audio.paused && !!this.cur;
  }

  get progress() {
    return this._audio?.currentTime || 0;
  }

  get duration() {
    const d = this._audio?.duration;
    return Number.isFinite(d) && d > 0 ? d : this.cur?.duration || 0;
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(force = false) {
    const now = Date.now();
    if (!force && now - this._lastEmit < 240) return;
    this._lastEmit = now;
    const snap = this.snapshot();
    this._listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {
        /* 单个订阅出错不影响其它 */
      }
    });
  }

  snapshot() {
    return {
      cur: this.cur,
      playing: this.playing,
      progress: this.progress,
      duration: this.duration,
      loading: this.loading,
      error: this.error,
      queue: this.queue,
      index: this.index,
      server: this.server,
    };
  }

  _audioEl() {
    if (this._audio) return this._audio;
    const a = new Audio();
    a.preload = 'auto';
    a.addEventListener('timeupdate', () => this._emit());
    a.addEventListener('durationchange', () => this._emit(true));
    a.addEventListener('play', () => this._emit(true));
    a.addEventListener('pause', () => this._emit(true));
    a.addEventListener('ended', () => this.next());
    a.addEventListener('error', () => {
      if (a.src) this.error = '这首歌播不了，可能是格式或权限问题';
      this._emit(true);
    });
    this._audio = a;
    return a;
  }

  /** 设置服务器（配置变更时调用） */
  setServer(server) {
    if (this.server?.id !== server?.id || this.server?.url !== server?.url) {
      this.server = server;
    }
  }

  /**
   * 播放一个列表
   * @param {Array} list 歌曲数组
   * @param {number} i 起始下标
   * @param {object} server 服务器配置
   */
  playQueue(list, i = 0, server) {
    if (server) this.server = server;
    if (!Array.isArray(list) || !list.length) return;
    this.queue = list;
    this.index = Math.max(0, Math.min(i, list.length - 1));
    this._start();
  }

  /** 没有队列时，随机取一批歌来播 */
  async playAny(server) {
    if (server) this.server = server;
    if (this.queue.length) {
      if (!this.playing) this.toggle();
      return;
    }
    if (!this.server) {
      this.error = '还没有配置音乐服务器';
      this._emit(true);
      return;
    }
    this.loading = true;
    this.error = '';
    this._emit(true);
    try {
      const list = await getRandomSongs(this.server, 30);
      if (!list.length) {
        this.error = '音乐库是空的，先去 Navidrome 扫一次库';
        this.loading = false;
        this._emit(true);
        return;
      }
      this.queue = list;
      this.index = 0;
      this.loading = false;
      this._start();
    } catch (e) {
      this.loading = false;
      this.error = e?.message || '取歌失败';
      this._emit(true);
    }
  }

  _start() {
    const song = this.cur;
    if (!song || !this.server) return;
    this.error = '';
    const a = this._audioEl();
    a.src = streamUrl(this.server, song.id);
    a.play()
      .then(() => this._emit(true))
      .catch(() => {
        this.error = '浏览器拦截了自动播放，再点一次播放按钮';
        this._emit(true);
      });
  }

  toggle() {
    if (!this.cur) {
      this.playAny(this.server);
      return;
    }
    const a = this._audioEl();
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  next() {
    if (!this.queue.length) return;
    this.index = (this.index + 1) % this.queue.length;
    this._start();
  }

  prev() {
    if (!this.queue.length) return;
    this.index = (this.index - 1 + this.queue.length) % this.queue.length;
    this._start();
  }

  seek(sec) {
    const a = this._audioEl();
    if (Number.isFinite(sec)) a.currentTime = sec;
    this._emit(true);
  }

  stop() {
    const a = this._audioEl();
    a.pause();
    a.src = '';
    this.queue = [];
    this.index = -1;
    this._emit(true);
  }

  cover(size = 120) {
    if (!this.cur || !this.server) return '';
    return coverUrl(this.server, this.cur.coverArt, size);
  }
}

export const player = new Player();
