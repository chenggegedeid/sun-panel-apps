#!/usr/bin/env python3
"""
为音乐库批量补 .lrc 歌词文件（数据源：lrclib.net，免费、无需 Key）

用法：
    python3 fetch_lyrics.py /path/to/music
    python3 fetch_lyrics.py /path/to/music --limit 20        # 只处理 20 首，先试试效果
    python3 fetch_lyrics.py /path/to/music --dry-run          # 只看会写哪些，不落盘
    python3 fetch_lyrics.py /path/to/music --overwrite        # 已有 .lrc 也重下

说明：
- 只读音频文件，不修改音频本身，只在同目录写同名 .lrc
- 已有 .lrc 默认跳过
- 装了 mutagen 会读音频标签拿歌手/歌名/时长，匹配更准；没装则从文件名推断
- 匹配不到或只有纯文本歌词时，会打印出来，方便手动处理

Navidrome 会自动读同目录的同名 .lrc，扫描后歌词就有了。
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://lrclib.net/api"
UA = "sunpanel-music-lyrics/1.0 (https://github.com/chenggegedeid)"
AUDIO_EXT = {".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".wma", ".ape"}

try:
    from mutagen import File as MutagenFile  # type: ignore
except ImportError:
    MutagenFile = None


def http_json(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def read_tags(path):
    """返回 (artist, title, album, duration) ，读不到就是 None"""
    artist = title = album = None
    duration = None
    if MutagenFile:
        try:
            m = MutagenFile(path, easy=True)
            if m:
                g = lambda k: (m.get(k) or [None])[0]  # noqa: E731
                artist = g("artist")
                title = g("title")
                album = g("album")
                if getattr(m, "info", None):
                    duration = getattr(m.info, "length", None)
        except Exception:
            pass

    base = os.path.splitext(os.path.basename(path))[0]
    if not title:
        # 常见命名："01 - 歌手 - 歌名" / "歌手 - 歌名" / "01 歌名"
        m = re.match(r"^\d{1,3}[\s._-]+(.+)$", base)
        rest = m.group(1) if m else base
        if " - " in rest:
            left, right = rest.split(" - ", 1)
            if not artist:
                artist = left.strip()
            title = right.strip()
        else:
            title = rest.strip()
    if not album:
        album = os.path.basename(os.path.dirname(path)) or None
    return artist, title, album, duration


def clean(s):
    if not s:
        return ""
    s = re.sub(r"\(.*?\)|\[.*?\]|（.*?）|【.*?】", "", s)
    return s.strip()


def search_lyrics(artist, title, album, duration):
    """返回 (lrc_text, info) 或 (None, None)
    先精确（含专辑），搜不到再逐级放宽，避免专辑名把结果卡死
    """
    t = clean(title)
    a = clean(artist)
    al = clean(album)

    queries = []
    if a and al:
        queries.append({"track_name": t, "artist_name": a, "album_name": al})
    if a:
        queries.append({"track_name": t, "artist_name": a})
    queries.append({"track_name": t})

    last_err = None
    for q in queries:
        url = f"{API}/search?" + urllib.parse.urlencode(q)
        try:
            results = http_json(url)
        except Exception as e:
            last_err = f"请求失败: {e}"
            continue

        if not isinstance(results, list) or not results:
            continue

        # 有同步歌词优先；时长接近的再加分
        def score(it):
            s = 0
            if it.get("syncedLyrics"):
                s += 100
            d = it.get("duration")
            if duration and d:
                s += max(0, 20 - abs(float(d) - float(duration)))
            return s

        results.sort(key=score, reverse=True)
        best = results[0]
        lrc = best.get("syncedLyrics")
        if lrc:
            return lrc, f"{best.get('trackName')} - {best.get('artistName')}（同步）"
        lrc = best.get("plainLyrics")
        if lrc:
            return lrc, f"{best.get('trackName')} - {best.get('artistName')}（仅纯文本）"

    return None, last_err or "没搜到"


def main():
    ap = argparse.ArgumentParser(description="为音乐库批量补 .lrc 歌词")
    ap.add_argument("dir", help="音乐目录")
    ap.add_argument("--limit", type=int, default=0, help="最多处理多少首（0 = 不限）")
    ap.add_argument("--dry-run", action="store_true", help="只显示结果，不写文件")
    ap.add_argument("--overwrite", action="store_true", help="已存在 .lrc 也重新下载")
    ap.add_argument("--sleep", type=float, default=0.4, help="每首之间的间隔秒数，别把接口打挂")
    args = ap.parse_args()

    root = os.path.abspath(os.path.expanduser(args.dir))
    if not os.path.isdir(root):
        print(f"目录不存在: {root}")
        sys.exit(1)

    print(f"扫描目录: {root}")
    print(f"标签读取: {'mutagen 已启用' if MutagenFile else '未安装 mutagen，改为从文件名推断'}")
    print("-" * 60)

    total = written = plain = missed = skipped = 0
    missed_list = []

    for dirpath, _dirs, files in os.walk(root):
        for fn in sorted(files):
            ext = os.path.splitext(fn)[1].lower()
            if ext not in AUDIO_EXT:
                continue

            path = os.path.join(dirpath, fn)
            lrc_path = os.path.splitext(path)[0] + ".lrc"

            if os.path.exists(lrc_path) and not args.overwrite:
                skipped += 1
                continue

            total += 1
            artist, title, album, duration = read_tags(path)
            if not title:
                print(f"[跳过] 无法识别歌名: {fn}")
                missed += 1
                continue

            lrc, info = search_lyrics(artist, title, album, duration)
            if args.limit and total > args.limit:
                print(f"\n已达 --limit {args.limit}，停止")
                break

            if lrc:
                if not args.dry_run:
                    with open(lrc_path, "w", encoding="utf-8") as f:
                        f.write(lrc if lrc.endswith("\n") else lrc + "\n")
                written += 1
                if info and info.startswith("仅纯文本"):
                    plain += 1
                print(f"[OK] {os.path.relpath(path, root)}  ->  {info}")
            else:
                missed += 1
                missed_list.append((os.path.relpath(path, root), info))
                print(f"[--] {os.path.relpath(path, root)}  ({info})")

            time.sleep(max(0, args.sleep))

    print("-" * 60)
    print(f"处理 {total} 首 | 写入 {written} | 其中纯文本 {plain} | 失败 {missed} | 已有跳过 {skipped}")
    if missed_list:
        print("\n没拿到歌词的（可以手动补或换关键词重试）:")
        for p, r in missed_list[:20]:
            print(f"  - {p}  ({r})")
        if len(missed_list) > 20:
            print(f"  ... 还有 {len(missed_list) - 20} 个")
    if args.dry_run:
        print("\n这是 --dry-run，没有写任何文件")


if __name__ == "__main__":
    main()
