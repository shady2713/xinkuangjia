/**
 * 图标组件工厂：把 iconify 图标名包装成可直接在模板中使用的组件。
 * 只负责把图标名与 attrs 透传给 @iconify/vue，
 * 图标数据需调用方先经 addIcon 或 addCollection 注册。
 */
import { defineComponent, h } from 'vue';

import { Icon } from '@iconify/vue';

function createIconifyIcon(icon: string) {
  return defineComponent({
    name: `Icon-${icon}`,
    setup(props, { attrs }) {
      return () => h(Icon, { icon, ...props, ...attrs });
    },
  });
}

export { createIconifyIcon };
