/**
 * 气泡提示模块入口：注册 v-tippy 指令并写入全局默认属性（延迟、HTML、主题）。
 * 同时导出 Tippy 组件包装，把 auto 主题按当前明暗模式归一成 tippy 可识别的取值。
 * 只负责配置与主题转换，气泡内容与触发时机仍由使用方决定。
 */
import type { DefaultProps, Props } from 'tippy.js';

import type { App, SetupContext } from 'vue';

import { h, watchEffect } from 'vue';
import { setDefaultProps, Tippy as TippyComponent } from 'vue-tippy';

import { usePreferences } from '@vben-core/preferences';

import useTippyDirective from './directive';

import 'tippy.js/dist/tippy.css';
import 'tippy.js/dist/backdrop.css';
import 'tippy.js/themes/light.css';
import 'tippy.js/animations/scale.css';
import 'tippy.js/animations/shift-toward.css';
import 'tippy.js/animations/shift-away.css';
import 'tippy.js/animations/perspective.css';

const { isDark } = usePreferences();
/** 气泡提示属性：tippy 原生属性，外加动画名与 auto/dark/light 三种主题取值。 */
export type TippyProps = Partial<
  Props & {
    animation?:
      | 'fade'
      | 'perspective'
      | 'scale'
      | 'shift-away'
      | 'shift-toward'
      | boolean;
    theme?: 'auto' | 'dark' | 'light';
  }
>;

/**
 * 初始化全局提示：写入默认属性、注册 v-tippy 指令，并在未固定主题时跟随明暗模式。
 * @param app Vue 应用实例，用于注册指令。
 * @param options 调用方覆盖的默认属性；未传时按当前明暗模式自动刷新主题。
 */
export function initTippy(app: App<Element>, options?: Partial<DefaultProps>) {
  setDefaultProps({
    allowHTML: true,
    delay: [500, 200],
    theme: isDark.value ? '' : 'light',
    ...options,
  });
  if (!options || !Reflect.has(options, 'theme') || options.theme === 'auto') {
    watchEffect(() => {
      setDefaultProps({ theme: isDark.value ? '' : 'light' });
    });
  }

  app.directive('tippy', useTippyDirective(isDark));
}

/**
 * Tippy 组件的包装函数：合并调用方属性与透传属性，并把 theme 归一化为
 * tippy 能识别的取值（auto 依据当前主题落成空串或 light）。
 * @param props 由组件实例传入的属性，本组件不单独声明 props，统一并入透传属性。
 * @param context 组件的渲染上下文，本组件只取其中的透传属性与插槽。
 * @param context.attrs 透传属性。
 * @param context.slots 插槽。
 * @returns 渲染 TippyComponent 的 vnode。
 */
export const Tippy = (
  props: Record<string, unknown>,
  { attrs, slots }: SetupContext,
) => {
  let theme: string = (attrs.theme as string) ?? 'auto';
  if (theme === 'auto') {
    theme = isDark.value ? '' : 'light';
  }
  if (theme === 'dark') {
    theme = '';
  }
  return h(
    TippyComponent,
    {
      ...props,
      ...attrs,
      theme,
    },
    slots,
  );
};
