/**
 * 组件配置
 * 页面与小部件注册（name 全局不可重复）
 */

import { MusicWidget } from '../src/components/widget.js';
import { MusicConfig } from '../src/components/widgetConfig.js';
import { MusicMain } from '../src/components/mainPage.js';

export default {
  pages: {
    'music-config': {
      component: MusicConfig,
      type: 'config',
      background: 'linear-gradient(160deg, #eef2fb 0%, #f7f1f8 100%)',
      backgroundDark: 'linear-gradient(160deg, #1a1d26 0%, #241d29 100%)',
      headerTextColor: '#15171a',
      headerTextColorDark: '#f2f2f7',
      width: 760,
      height: 720,
      resize: true,
    },

    'music-main': {
      component: MusicMain,
      type: 'main',
      background: '#0b0d12',
      backgroundDark: '#0b0d12',
      headerTextColor: '#e8eaf0',
      headerTextColorDark: '#e8eaf0',
      width: 1080,
      height: 720,
      showFullscreenBtn: true,
      resize: true,
    },
  },

  widgets: {
    'music-widget': {
      component: MusicWidget,
      configComponentName: 'music-config',
      size: ['1x1', '1x2', '2x1', '2x2', '2x4', '4x4', '1xfull'],
      // 卡片透明，由组件自己决定底色
      background: 'transparent',
      isModifyBackground: true,
      widgetName: '$t:WIDGET_NAME',
      widgetDescription: '$t:WIDGET_DESCRIPTION',
      sort: 20,
    },
  },
};
