/**
 * 微应用配置
 * 音乐：把自建音乐服务（飞牛音乐 / Navidrome 等）装进导航页
 */

export default {
  appJsonVersion: '1.1',
  // 开发者标识（microAppId 必须以此开头）
  author: 'chenggegedeid',
  // 应用唯一标识
  microAppId: 'chenggegedeid-Music',
  version: '3.0.3',
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

  // 只需要数据节点（存服务器地址与外观设置）
  // network：接口请求走宿主网络透传（api.network.request），不再用原生 fetch
  permissions: ['dataNode', 'network'],

  // 目标音乐服务器由用户自行填写，域名不可预知，因此放开全部域名
  networkDomains: ['*'],

  dataNodes: {
    music: {
      scope: 'user',
      isPublic: false,
    },
  },
};
