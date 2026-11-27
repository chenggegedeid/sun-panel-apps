/**
 * 组件配置
 * 页面与小部件注册（name 全局不可重复）
 */

import { GatelyWidget } from '../src/components/widget.js';
import { GatelyConfig } from '../src/components/widgetConfig.js';
import { GatelyMain } from '../src/components/mainPage.js';

export default {
  pages: {
    'gately-config': {
      component: GatelyConfig,
      type: 'config',
      background: 'linear-gradient(160deg, #eef7f4 0%, #f4f6fb 100%)',
      backgroundDark: 'linear-gradient(160deg, #131a19 0%, #171a21 100%)',
      headerTextColor: '#15171a',
      headerTextColorDark: '#f2f2f7',
      width: 760,
      // 多台服务器后设置页变长，给高一点，少滚动
      height: 820,
      resize: true,
    },

    'gately-main': {
      component: GatelyMain,
      type: 'main',
      background: '#0c1211',
      backgroundDark: '#0c1211',
      headerTextColor: '#e8eaf0',
      headerTextColorDark: '#e8eaf0',
      width: 1120,
      height: 760,
      showFullscreenBtn: true,
      resize: true,
    },
  },

  widgets: {
    'gately-widget': {
      component: GatelyWidget,
      configComponentName: 'gately-config',
      size: ['1x1', '1x2', '2x1', '2x2', '2x4', '4x4', '1xfull'],
      // 卡片透明，由组件自己决定底色
      background: 'transparent',
      isModifyBackground: true,
      widgetName: '$t:WIDGET_NAME',
      widgetDescription: '$t:WIDGET_DESCRIPTION',
      sort: 30,
    },
  },
};
