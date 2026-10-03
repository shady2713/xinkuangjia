import type { ComputedRef, Directive } from 'vue';

import { useTippy } from 'vue-tippy';

/**
 * 生成 v-tippy 指令：根据绑定值与修饰符组装 tippy 配置，挂载时创建实例、卸载时销毁。
 * 指令同时承担主题跟随：updated 钩子会在深色模式切换时刷新 tippy 的 theme。
 * @param isDark 当前是否为深色模式，用于把 auto 主题落成 tippy 可识别的取值。
 * @returns 可注册到 Vue app 上的指令对象。
 */
export default function useTippyDirective(isDark: ComputedRef<boolean>) {
  const directive: Directive = {
    /**
     * 元素挂载后创建 tippy 实例：字符串绑定值作为内容，对象绑定值作为完整配置，
     * 并把元素上的 title / content 迁移为 tippy 内容后移除原属性。
     * @param el 指令作用的 DOM 元素。
     * @param binding 指令绑定值，决定内容与配置来源。
     * @param vnode 元素对应的虚拟节点，用于读取 onTippy* 生命周期回调。
     */
    mounted(el, binding, vnode) {
      const opts =
        typeof binding.value === 'string'
          ? { content: binding.value }
          : binding.value || {};

      const modifiers = Object.keys(binding.modifiers || {});
      const placement = modifiers.find((modifier) => modifier !== 'arrow');
      const withArrow = modifiers.includes('arrow');

      if (placement) {
        opts.placement = opts.placement || placement;
      }

      if (withArrow) {
        opts.arrow = opts.arrow === undefined ? true : opts.arrow;
      }

      if (vnode.props && vnode.props.onTippyShow) {
        opts.onShow =
          /** 转发元素上声明的 onTippyShow 回调，保持 tippy 的触发时机不变。 */
          function (...args: unknown[]) {
            return vnode.props?.onTippyShow(...args);
          };
      }

      if (vnode.props && vnode.props.onTippyShown) {
        opts.onShown =
          /** 转发元素上声明的 onTippyShown 回调，保持 tippy 的触发时机不变。 */
          function (...args: unknown[]) {
            return vnode.props?.onTippyShown(...args);
          };
      }

      if (vnode.props && vnode.props.onTippyHidden) {
        opts.onHidden =
          /** 转发元素上声明的 onTippyHidden 回调，保持 tippy 的触发时机不变。 */
          function (...args: unknown[]) {
            return vnode.props?.onTippyHidden(...args);
          };
      }

      if (vnode.props && vnode.props.onTippyHide) {
        opts.onHide =
          /** 转发元素上声明的 onTippyHide 回调，保持 tippy 的触发时机不变。 */
          function (...args: unknown[]) {
            return vnode.props?.onTippyHide(...args);
          };
      }

      if (vnode.props && vnode.props.onTippyMount) {
        opts.onMount =
          /** 转发元素上声明的 onTippyMount 回调，保持 tippy 的触发时机不变。 */
          function (...args: unknown[]) {
            return vnode.props?.onTippyMount(...args);
          };
      }

      if (el.getAttribute('title') && !opts.content) {
        opts.content = el.getAttribute('title');
        el.removeAttribute('title');
      }

      if (el.getAttribute('content') && !opts.content) {
        opts.content = el.getAttribute('content');
      }

      useTippy(el, opts);
    },
    unmounted(el) {
      if (el.$tippy) {
        el.$tippy.destroy();
      } else if (el._tippy) {
        el._tippy.destroy();
      }
    },

    updated(el, binding) {
      const opts =
        typeof binding.value === 'string'
          ? { content: binding.value, theme: isDark.value ? '' : 'light' }
          : Object.assign(
              { theme: isDark.value ? '' : 'light' },
              binding.value,
            );

      if (el.getAttribute('title') && !opts.content) {
        opts.content = el.getAttribute('title');
        el.removeAttribute('title');
      }

      if (el.getAttribute('content') && !opts.content) {
        opts.content = el.getAttribute('content');
      }

      if (el.$tippy) {
        el.$tippy.setProps(opts || {});
      } else if (el._tippy) {
        el._tippy.setProps(opts || {});
      }
    },
  };
  return directive;
}
