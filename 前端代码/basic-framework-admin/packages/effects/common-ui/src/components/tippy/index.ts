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

export function initTippy(app: App<Element>, options?: DefaultProps) {
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
