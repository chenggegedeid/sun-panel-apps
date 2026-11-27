# Sun-Panel 微应用合集

给 [Sun-Panel](https://sunpanel.top) 导航面板写的一些小应用。每个应用都是独立的微应用包，可以单独安装。

> ⚠️ **禁止商业使用**，详见 [LICENSE](LICENSE)。

## 应用清单

| 应用 | 说明 | 仓库目录 | 商店 |
|---|---|---|---|
| **日历倒计时** | 背景真正透明的日历 / 倒计时卡片，支持农历、二十四节气与自定义纪念日，七种尺寸自适应 | [`calendar/`](calendar/) | Sun-Panel 应用商店搜「日历倒计时」 |
| **音乐** | 在导航页里播放自建音乐库。卡片即播放器，点开有专辑墙、搜索和同步歌词，兼容 Subsonic 接口 | [`music/`](music/) | Sun-Panel 应用商店搜「音乐」 |

## 日历倒计时

![日历倒计时](calendar/docs/screenshots/01-overview.png)

- 背景完全透明（容器到内容都不画底色，并覆盖宿主卡片背景）
- 农历、节气、内置节日与自定义纪念日
- `1x1` `1x2` `2x1` `2x2` `2x4` `4x4` `1xfull` 七种尺寸

完整说明见 [calendar/README.md](calendar/README.md)。

## 音乐

![音乐卡片](music/docs/screenshots/01-cards.png)

- 卡片自带播放控制：播放/暂停、上下曲、进度条
- 音频是模块级单例，关掉播放窗口音乐不断
- 专辑墙、搜索、同步歌词（逐行高亮、点击跳转）
- 兼容 Navidrome / Gonic / Airsonic / Jellyfin（Subsonic 接口）

完整说明见 [music/README.md](music/README.md)，附一个批量补歌词的脚本 [music/tools/fetch-lyrics.py](music/tools/fetch-lyrics.py)。

## 目录结构

```
.
├─ calendar/             # 日历倒计时（独立微应用工程）
│  ├─ config/            #   应用信息与组件注册
│  ├─ src/               #   组件源码
│  ├─ docs/screenshots/  #   商店截图
│  └─ package.json       #   npm run dev / pack
├─ music/                # 音乐（独立微应用工程，结构同上）
└─ LICENSE               # 统一许可证：禁止商业使用
```

两个应用互不依赖，各自 `npm install && npm run dev` 即可开发。

## 开发一个应用

```bash
cd music           # 或 calendar
npm install
npm run dev        # 开发服务器，带热更新
npm run pack       # 打包生产版到 packages/
```

开发时可以把开发服务器的「入口 JS 地址」直接导入 Sun-Panel 预览，不必每次打包上传。细节见各应用 README 的「开发调试」一节。

## 许可证

**禁止商业使用。** 个人可免费使用、修改；分发需保留署名与许可证；修改后须标注「已修改」并同样禁止商用；商用需书面授权。

完整条款见 [LICENSE](LICENSE)。联系：[GitHub @chenggegedeid](https://github.com/chenggegedeid)
