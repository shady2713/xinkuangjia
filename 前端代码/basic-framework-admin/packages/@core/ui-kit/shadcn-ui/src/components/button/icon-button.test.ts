/**
 * 图标按钮（shadcn-ui 的 components/button/icon-button）提示分支回归。
 *
 * 图标按钮在只有图标的场景必须补一层提示：未配置提示时直接渲染圆形按钮，配置了 tooltip 属性
 * 或 tooltip 插槽时改用带提示的按钮，提示插槽优先于文本。分支判断写错会让图标按钮缺少说明或
 * 多出一层空提示。用例真实挂载组件并读取真实按钮与提示结构。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import IconButton from './icon-button.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载以清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

describe('图标按钮渲染分支', /** 分支写错会让图标按钮缺少说明或多出空提示。 */ () => {
  it('未配置提示时直接渲染圆形按钮', /** 无提示仍包一层提示会带来多余节点与焦点陷阱。 */ async () => {
    mounted = mount(IconButton, {
      props: { class: 'custom-icon-button', variant: 'icon' },
      slots: { default: '<i class="inner-icon"></i>' },
    });
    await nextTick();

    const button = mounted.find('button');
    expect(button.exists()).toBe(true);
    expect(button.classes()).toContain('rounded-full');
    expect(button.classes()).toContain('custom-icon-button');
    expect(mounted.find('.inner-icon').exists()).toBe(true);
  });

  it('配置 tooltip 属性时在获得焦点后展示提示文案', /** 提示未渲染会让用户不知道图标含义。 */ async () => {
    mounted = mount(IconButton, {
      props: { tooltip: '刷新缓存' },
      slots: { default: '<i class="inner-icon"></i>' },
    });

    expect(mounted.find('button').exists()).toBe(true);
    expect(document.body.textContent).not.toContain('刷新缓存');

    // 提示按真实焦点链路打开，内容只在打开后进入传送节点。
    await mounted.find('button').trigger('focus');

    expect(document.body.textContent).toContain('刷新缓存');
  });

  it('配置 tooltip 插槽时插槽优先于属性', /** 插槽被属性覆盖会让业务无法使用富文本提示。 */ async () => {
    mounted = mount(IconButton, {
      props: { tooltip: '属性文案' },
      slots: {
        default: '<i class="inner-icon"></i>',
        tooltip: '<b class="slot-tooltip">插槽文案</b>',
      },
    });

    await mounted.find('button').trigger('focus');

    expect(document.querySelector('.slot-tooltip')).not.toBeNull();
    expect(document.body.textContent).toContain('插槽文案');
    expect(document.body.textContent).not.toContain('属性文案');
  });

  it('点击时执行调用方回调且禁用态透传', /** 回调丢失会让图标按钮点了没反应。 */ async () => {
    const onClick = vi.fn();
    mounted = mount(IconButton, {
      props: { disabled: true, onClick },
      slots: { default: '<i class="inner-icon"></i>' },
    });
    await nextTick();

    const button = mounted.find('button');
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    expect(onClick).not.toHaveBeenCalled();
  });
});
