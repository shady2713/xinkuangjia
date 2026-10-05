/**
 * 浮层封装（shadcn-ui 的 components/popover）触发与开合回归。
 *
 * 该浮层把触发插槽与内容插槽组装成受控浮层：触发件必须渲染调用方传入的元素，内容只在打开后
 * 出现，触发件与内容的样式类必须按调用方传入的值生效。开合或样式类写错会让筛选入口点不开或
 * 浮层外观失控。用例用真实的受控宿主挂载 reka-ui 的浮层根节点，读取真实开合状态与传送后的 DOM。
 */
import { mount } from '@vue/test-utils';

import { afterEach, describe, expect, it } from 'vitest';

import Popover from './popover.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载以清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

describe('浮层封装渲染与开合', /** 触发件与内容决定筛选面板是否可用。 */ () => {
  it('关闭时渲染触发件但不渲染内容', /** 关闭仍渲染会让页面出现残留浮层。 */ () => {
    mounted = mount(Popover, {
      props: { contentClass: 'custom-content', triggerClass: 'custom-trigger' },
      slots: {
        default: '筛选项',
        trigger: '<span class="filter-entry">筛选</span>',
      },
    });

    const trigger = mounted.find('.custom-trigger');
    expect(trigger.element.tagName).toBe('BUTTON');
    expect(trigger.attributes('data-state')).toBe('closed');
    expect(mounted.find('.filter-entry').text()).toBe('筛选');
    expect(document.querySelector('.custom-content')).toBeNull();
  });

  it('点击触发件抛出展开请求', /** 不抛出请求会让调用方无法展开筛选面板。 */ async () => {
    const requests: unknown[] = [];
    mounted = mount(Popover, {
      props: {
        /** 记录开合状态更新。 */
        'onUpdate:open': (value: unknown) => {
          requests.push(value);
        },
      },
      slots: {
        default: '筛选项',
        trigger: '<span class="filter-entry">筛选</span>',
      },
    });

    await mounted.find('.filter-entry').trigger('click');

    expect(requests[0]).toBe(true);
  });

  it('受控打开时渲染内容并透传内容属性', /** 受控值失效会让调用方无法主动展开浮层。 */ async () => {
    mounted = mount(Popover, {
      props: {
        contentClass: 'custom-content',
        contentProps: { align: 'end' },
        open: true,
      },
      slots: {
        default: '筛选项',
        trigger: '<span class="filter-entry">筛选</span>',
      },
    });
    await new Promise(
      /** 等待传送节点真实渲染完成。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(mounted.find('button').attributes('data-state')).toBe('open');
    const content = document.querySelector('.custom-content');
    expect(content).not.toBeNull();
    expect((content as HTMLElement | null)?.dataset.align).toBe('end');
    expect(document.body.textContent).toContain('筛选项');
  });
});
