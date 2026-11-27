/**
 * 微应用配置
 * Gately：把自托管网关的运行状态装进导航页
 */

export default {
  appJsonVersion: '1.1',
  // 开发者标识（microAppId 必须以此开头）
  author: 'chenggegedeid',
  // 应用唯一标识
  microAppId: 'chenggegedeid-Gately',
  version: '1.3.0',
  entry: 'main.js',
  icon: 'icon.png',
  debug: false,

  appInfo: {
    appName: '$t:APP_NAME',
    description: '$t:APP_DESCRIPTION',
    networkDescription: '$t:NETWORK_DESCRIPTION',
  },

  locales: {
    'zh-CN': 'zh-CN.json',
    'en-US': 'en-US.json',
  },

  defaultLocale: 'zh-CN',

  // dataNode：存网关地址、API 令牌与外观设置
  // network：请求走宿主网络透传（api.network.request），不在微应用里直接 fetch
  permissions: ['dataNode', 'network'],

  // Gately 可能部署在任意内网域名或端口上，无法预先枚举
  networkDomains: ['*'],

  dataNodes: {
    gately: {
      scope: 'user',
      isPublic: false,
    },
  },
};
