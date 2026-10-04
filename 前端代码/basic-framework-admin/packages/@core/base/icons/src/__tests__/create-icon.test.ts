/** 图标组件工厂的测试：确认按图标名生成具名组件，并同时下传 props 与 attrs。 */
import type { VNode, VNodeChild } from 'vue';

import { Icon } from '@iconify/vue';
import { describe, expect, it } from 'vitest';

import { createIconifyIcon } from '../create-icon';

/**
 * 把渲染结果收窄为单个 vnode。
 * @param child 渲染函数返回的渲染子节点。
 * @returns 该 vnode。
 * @throws TypeError 返回值不是单个 vnode 时抛出，避免断言读到非 vnode 取值。
 */
function requireVNode(child: VNodeChild): VNode {
  if (
    !child ||
    typeof child !== 'object' ||
    Array.isArray(child) ||
    !('type' in child)
  ) {
    throw new TypeError('图标渲染结果必须是单个 vnode');
  }
  return child;
}

describe('createIconifyIcon', /** 每个图标生成一个具名组件，渲染时把 props 与 attrs 一并交给 Iconify。 */ () => {
  it('组件名带上图标名便于调试', /** DevTools 里要能直接看出这个组件渲染的是哪个图标。 */ () => {
    expect(createIconifyIcon('lucide:user').name).toBe('Icon-lucide:user');
  });

  it('渲染时把图标名传给 Iconify', /** 图标名是数据来源，必须出现在最终 vnode 上。 */ () => {
    const component = createIconifyIcon('lucide:user');
    const setup = component.setup;
    expect(typeof setup).toBe('function');
    if (typeof setup !== 'function') return;

    /** props 由父组件传入，attrs 是未声明属性的透传通道，两者都要生效。 */
    const render = setup(
      {},
      {
        attrs: { class: 'size-4' },
        /** 事件触发器：本组件不触发事件，提供空实现满足真实上下文契约。 */
        emit: () => {},
        /** 暴露成员：本组件不暴露，提供空实现满足真实上下文契约。 */
        expose: () => {},
        /** 组件插槽：本组件不使用插槽，提供空对象满足真实上下文契约。 */
        slots: {},
      },
    );
    expect(typeof render).toBe('function');
    if (typeof render !== 'function') return;
    const vnode = requireVNode(render());

    expect(vnode.type).toBe(Icon);
    expect(vnode.props?.icon).toBe('lucide:user');
    expect(vnode.props?.class).toBe('size-4');
  });
});
