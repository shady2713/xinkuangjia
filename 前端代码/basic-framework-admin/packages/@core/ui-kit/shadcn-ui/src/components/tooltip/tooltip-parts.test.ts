/**
 * 提示封装（shadcn-ui 的 components/tooltip）触发与默认图标回归。
 *
 * 提示封装用于给纯图标按钮补文案：提示内容只在触发元素获得焦点或指针悬停后渲染，触发插槽必须
 * 能被调用方替换，帮助提示未传触发插槽时必须渲染默认问号图标。内容不渲染会让说明入口形同虚设。
 * 用例真实挂载 reka-ui 的提示根节点，用真实焦点事件打开提示，并读取传送后的真实 DOM。
 */
import { mount } from '@vue/test-utils';

import { afterEach, describe, expect, it } from 'vitest';

import HelpTooltip from './help-tooltip.vue';
import VbenTooltip from './tooltip.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载以清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

describe('提示封装渲染', /** 触发插槽与内容决定用户能否看到说明。 */ () => {
  it('渲染调用方提供的触发元素并在获得焦点后展示内容', /** 触发元素或内容缺失会让说明入口形同虚设。 */ async () => {
    mounted = mount(VbenTooltip, {
      props: { contentClass: 'custom-content', delayDuration: 0, side: 'top' },
      slots: {
        default: '字段说明',
        trigger: '<button class="custom-trigger">说明</button>',
      },
    });

    expect(mounted.find('.custom-trigger').text()).toBe('说明');
    expect(document.body.textContent).not.toContain('字段说明');

    // 提示按真实焦点链路打开，内容只在打开后进入传送节点。
    await mounted.find('.custom-trigger').trigger('focus');

    expect(document.body.textContent).toContain('字段说明');
    expect(document.querySelector('.custom-content')?.className).toContain(
      'side-content',
    );
    expect(
      (document.querySelector('.custom-content') as HTMLElement | null)?.dataset
        .side,
    ).toBe('top');
  });

  it('帮助提示未传触发插槽时渲染默认问号图标', /** 缺少默认图标会让帮助入口变成空白。 */ () => {
    mounted = mount(HelpTooltip, {
      props: { triggerClass: 'custom-help' },
      slots: { default: '帮助说明' },
    });

    expect(mounted.find('svg').exists()).toBe(true);
    expect(mounted.find('svg').classes()).toContain('cursor-pointer');
    expect(mounted.find('svg').classes()).toContain('custom-help');
  });

  it('帮助提示支持替换触发元素并在获得焦点后展示内容', /** 无法替换会让业务无法使用自定义帮助入口。 */ async () => {
    mounted = mount(HelpTooltip, {
      slots: {
        default: '帮助说明',
        trigger: '<i class="custom-icon">?</i>',
      },
    });

    expect(mounted.find('.custom-icon').exists()).toBe(true);
    expect(mounted.find('svg').exists()).toBe(false);

    await mounted.find('.custom-icon').trigger('focus');

    expect(document.body.textContent).toContain('帮助说明');
  });
});
