/** 图标组件工厂的测试：确认按图标名生成具名组件，并同时下传 props 与 attrs。 */
import { Icon } from '@iconify/vue';
import { describe, expect, it } from 'vitest';

import { createIconifyIcon } from '../create-icon';

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
    const render = setup({}, { attrs: { class: 'size-4' } });
    expect(typeof render).toBe('function');
    if (typeof render !== 'function') return;
    const vnode = render();

    expect(vnode.type).toBe(Icon);
    expect(vnode.props?.icon).toBe('lucide:user');
    expect(vnode.props?.class).toBe('size-4');
  });
});
