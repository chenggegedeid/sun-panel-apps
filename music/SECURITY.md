# 安全说明

本文件用于回应应用商店静态扫描的提示。扫描对 `main.js` 报了 4 条中危（2 × `DOM_SECURITY: innerHTML`、2 × `NATIVE_API: fetch`），下面逐条说明来源与风险判断。

---

## 1. 网络请求：已改用宿主 network.request

> **2.0.0 起已按平台规范改造**：应用内不再使用原生 `fetch`，所有接口请求都通过宿主提供的 `this.spCtx.api.network.request()`（网络透传）发出。

改造前静态扫描会报 `NATIVE_API: fetch`（2 处）：

| 序号 | 来源 | 说明 |
|---|---|---|
| 1 | `@sun-panel/micro-app` SDK | 加载语言包 `{staticPath}/locales/zh-CN.json`，属 SDK 自身行为 |
| 2 | 应用自身 | 调用 Subsonic 接口，**2.0.0 已改为 network.request** |

现有实现（`src/utils/subsonic.js`）：

```js
// 组件初始化时注入宿主 API
setRequestAdapter((opts) => this.spCtx.api.network.request(opts));

// 请求时只传 URL，由宿主代为发出
response = await requestAdapter({ request: { targetUrl: url, method: 'GET' } });
```

配套改动：

- `app.config.js` 声明 `permissions: ['dataNode', 'network']`
- `networkDomains: ['*']` —— 目标服务器由用户自行填写，域名不可预知，因此放开全部域名
- 不再需要 `credentials: 'omit'`：请求由宿主持有，浏览器侧不携带任何 Cookie
- 跨域不再由浏览器限制，改由宿主转发，`CORS` 相关问题自然消失

因此现在产物中只剩 SDK 自身那 1 处 `fetch`（语言包加载），应用代码 0 处。

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

- 网络请求已按平台规范改用 `api.network.request`，应用代码中不再有原生 `fetch`
- `innerHTML` 属于 lit-html 的模板编译过程，输入为静态字符串

`innerHTML` 若要彻底消除，只能更换模板引擎，代价过大且无安全收益，故保持现状。

如有疑问，欢迎通过 [GitHub @chenggegedeid](https://github.com/chenggegedeid) 联系。
