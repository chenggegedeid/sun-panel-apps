# 安全说明

本文件用于回应应用商店静态扫描的提示。扫描对 `main.js` 报了 4 条中危（2 × `DOM_SECURITY: innerHTML`、2 × `NATIVE_API: fetch`），下面逐条说明来源与风险判断。

---

## 1. NATIVE_API: fetch × 2

两处 `fetch` 都是功能必需，且请求目标受控。

| 序号 | 来源 | 作用 | 目标地址 |
|---|---|---|---|
| 1 | `@sun-panel/micro-app` SDK | 加载语言包 | 面板自身的静态资源 `{staticPath}/locales/zh-CN.json` |
| 2 | `src/utils/subsonic.js` → `call()` | 调用 Subsonic 接口 | **用户在配置页自己填写的音乐服务器** |

第 2 处的调用代码（`src/utils/subsonic.js`）：

```js
res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', mode: 'cors' });
```

安全约束：

- `url` = `normalizeBase(server.url)` + 固定接口路径，`server.url` 只能由用户在配置页填写，代码里没有任何硬编码的远程地址
- `credentials: 'omit'` —— 不携带 Cookie，跨域调用不会泄露面板登录态
- 12 秒超时（`AbortController`），失败只影响本次请求
- 全包检索无第三方域名、无埋点、无 CDN

这是网页播放器访问远程音乐库的唯一方式：浏览器里没有其他 API 能在不发 Cookie 的前提下读取跨域 JSON。

## 2. DOM_SECURITY: innerHTML × 2

两处均来自 lit-html 框架内部的模板解析，不在应用代码里：

```js
static createElement(t, e) {
  const i = document.createElement('template');
  i.innerHTML = t;   // t 为编译期固定的模板字符串
  return i;
}
```

- `t` 由构建时的 `` html`...` `` 标签生成，是**静态模板字符串**，不含运行时数据拼接
- `src/` 目录下没有一处直接使用 `innerHTML`（可用 `grep -rn innerHTML src/` 验证，结果为空）
- 出现 2 次是因为 lit-html 被打进两份：应用自身的 lit，以及 SDK 预构建产物内自带的 lit（同一份框架代码，两处实现完全相同）

## 3. 其他高危 API 自查

| API | 出现次数 |
|---|---|
| `eval` / `new Function` | 0 |
| `document.write` | 0 |
| `insertAdjacentHTML` | 0 |
| `iframe` / `srcdoc` | 0 |
| `localStorage` / `sessionStorage` | 0 |
| `postMessage` | 0 |

## 4. 数据流向

- **服务器地址 / 用户名 / 密码**：写入 Sun-Panel 的**用户级数据节点**（服务端存储），不使用浏览器存储，不经过任何第三方
- **密码**：只用于本地计算 Subsonic token `md5(密码 + 随机 salt)`，明文不出浏览器；请求只带 token，不带密码
- **音频流**：`<audio>` 直接从用户自己的服务器加载，本应用不做任何中转、不落盘

## 5. 结论

上述 4 条提示属于「使用了某个 API」的事实陈述，不是可利用的漏洞：

- `fetch` 是访问用户自建音乐服务的必要手段，且目标完全由用户决定
- `innerHTML` 属于 lit-html 的模板编译过程，输入为静态字符串

如需进一步降低扫描噪音，可以把 `fetch` 换成 `XMLHttpRequest`，或用 `innerHTML` 之外的解析方式引入框架——但两者都不会带来实际安全收益，因此保持现状。

如有疑问，欢迎通过 [GitHub @chenggegedeid](https://github.com/chenggegedeid) 或 contact@example.com 联系。
