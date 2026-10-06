/**
 * 图标组件工厂：把 iconify 图标名包装成可直接在模板中使用的组件。
 * 只负责把图标名与 attrs 透传给 @iconify/vue，
 * 图标数据需调用方先经 addIcon 或 addCollection 注册。
 */
import { defineComponent, h } from 'vue';

import { Icon } from '@iconify/vue';

/**
 * 把 iconify 图标名包成一个 Vue 组件，组件名固定为 `Icon-{图标名}`。
 * 只做包装：图标数据必须由调用方先经 addIcon/addCollection 注册，未注册时的渲染结果由 @iconify/vue 决定。
 * @param icon - iconify 图标名，形如 `mdi:home`。
 * @returns 可注册的 Vue 组件，渲染时把该图标名与外部传入的 props/attrs 一起交给 @iconify/vue。
 */
function createIconifyIcon(icon: string) {
  return defineComponent({
    name: `Icon-${icon}`,
    /**
     * 图标组件的 setup：把图标名、props 与透传属性合成 @iconify/vue 的渲染参数。
     * @param props - 组件入参；该工厂未声明 props，正常运行时可视为空对象。
     * @param attrs - 从 setup 上下文解构出的透传属性，因排在 props 之后会覆盖同名入参。
     * @returns 渲染函数，每次渲染返回一个 Icon 组件虚拟节点。
     */
    setup(props, { attrs }) {
      return () => h(Icon, { icon, ...props, ...attrs });
    },
  });
}

export { createIconifyIcon };
