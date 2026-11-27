/**
 * 微应用配置
 * 日历 · 倒计时：真透明背景的日历卡片
 */

export default {
  // =======================
  // 应用基础信息
  // =======================
  appJsonVersion: '1.1',
  // 作者标识（开发者标识，microAppId 必须以此开头）
  author: 'chenggegedeid',
  // 应用唯一标识（必须与商店里已建应用的 ID 完全一致，注意大写 C）
  microAppId: 'chenggegedeid-Calendar',
  // 应用版本
  version: '1.1.1',
  // 入口文件
  entry: 'main.js',
  // 图标（放在 public 目录）
  icon: 'icon.png',
  // 正式发布请保持 false
  debug: false,

  // 应用信息（使用 '$t: xxx' 引用翻译）
  appInfo: {
    appName: '$t:APP_NAME',
    description: '$t:APP_DESCRIPTION',
    networkDescription: '$t:NETWORK_DESCRIPTION',
  },

  // 语言文件映射
  locales: {
    'zh-CN': 'zh-CN.json',
    'en-US': 'en-US.json',
  },

  defaultLocale: 'zh-CN',

  // 权限：只需要数据节点（存放倒计时事件）
  permissions: ['dataNode'],

  // 不联网
  networkDomains: [],

  // 数据节点：事件按用户隔离
  dataNodes: {
    events: {
      scope: 'user',
      isPublic: false,
    },
  },
};
