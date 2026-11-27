/**
 * 组件配置
 * 页面与小部件注册（name 全局不可重复）
 */

import { Widget as CalendarWidget } from '../src/components/widget.js';
import { WidgetConfig as CalendarConfig } from '../src/components/widgetConfig.js';
import { MainPage as CalendarMain } from '../src/components/mainPage.js';

export default {
  // =======================
  // 页面注册
  // =======================
  pages: {
    'calendar-config': {
      component: CalendarConfig,
      type: 'config',
      // 配置页背景（深色模式下用 backgroundDark）
      background: 'linear-gradient(160deg, #eef4fb 0%, #f7f4fb 100%)',
      backgroundDark: 'linear-gradient(160deg, #1a1f26 0%, #221d29 100%)',
      headerTextColor: '#15171a',
      headerTextColorDark: '#f2f2f7',
      width: 780,
      height: 760,
      resize: true,
    },

    'calendar-main': {
      component: CalendarMain,
      type: 'main',
      background: 'linear-gradient(160deg, #eef4fb 0%, #f7f4fb 100%)',
      backgroundDark: 'linear-gradient(160deg, #1a1f26 0%, #221d29 100%)',
      headerTextColor: '#15171a',
      headerTextColorDark: '#f2f2f7',
      width: 880,
      height: 600,
      showFullscreenBtn: true,
      resize: true,
    },
  },

  // =======================
  // 小部件（卡片）注册
  // =======================
  widgets: {
    'calendar-widget': {
      component: CalendarWidget,
      configComponentName: 'calendar-config',
      size: ['1x1', '1x2', '2x1', '2x2', '2x4', '4x4', '1xfull'],
      // 关键：让宿主卡片本身透明，配合组件内部不画底色，才能真的透出壁纸
      background: 'transparent',
      // 非公开文档字段：通知主应用用上面的 background 覆盖卡片默认底色
      isModifyBackground: true,
      widgetName: '$t:WIDGET_NAME',
      widgetDescription: '$t:WIDGET_DESCRIPTION',
      sort: 20,
    },
  },
};
