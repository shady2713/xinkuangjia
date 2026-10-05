/**
 * 浮层（shadcn-ui 的 ui/popover）开合与定位契约回归。
 *
 * 浮层用于承载筛选表单、说明等临时内容：触发件点击后必须请求打开，内容只在打开时渲染，
 * 并默认居中、与触发元素保持 4px 间距。开合或定位配置写错会让浮层点不开或贴住触发元素。
 * 用例真实挂载 reka-ui 的浮层根节点，读取真实开合事件与传送后的 DOM 节点。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import Popover from './Popover.vue';
import PopoverContent from './PopoverContent.vue';
import PopoverTrigger from './PopoverTrigger.vue';

/** 每个用例挂载的浮层宿主，用例结束后统一卸载以清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载浮层并清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

/**
 * 挂载浮层宿主。
 * @param open 是否直接以打开状态挂载。
 * @param openStates 记录开合状态变化的数组。
 * @returns 已挂载的浮层宿主包装器。
 */
function mountPopover(open: boolean, openStates: unknown[] = []) {
  return mount(
    h(
      Popover,
      {
        open,
        /** 记录开合状态更新。 */
        'onUpdate:open': (value: unknown) => {
          openStates.push(value);
        },
      },
      {
        /** 渲染触发件与浮层内容。 */
        default: () => [
          h(
            PopoverTrigger,
            { class: 'custom-trigger' },
            {
              /** 触发件文案。 */
              default: () => '筛选',
            },
          ),
          h(
            PopoverContent,
            { class: 'custom-content' },
            {
              /** 浮层内容。 */
              default: () => h('span', { class: 'popover-body' }, '筛选条件'),
            },
          ),
        ],
      },
    ),
  );
}

describe('浮层开合契约', /** 开合失效会让筛选或说明入口点了没反应。 */ () => {
  it('点击触发件请求打开浮层', /** 触发件未绑定开合状态会让入口失效。 */ async () => {
    const openStates: unknown[] = [];
    mounted = mountPopover(false, openStates);
    await nextTick();

    await mounted.find('button').trigger('click');
    await nextTick();

    expect(openStates).toEqual([true]);
    // 受控模式下显示状态由调用方决定，点击只负责抛出请求。
    expect(mounted.find('.custom-trigger').attributes('data-state')).toBe(
      'closed',
    );
  });

  it('打开时渲染内容并使用默认定位', /** 默认对齐与间距写错会让浮层贴住触发元素。 */ async () => {
    mounted = mountPopover(true);
    await nextTick();
    await nextTick();

    expect(document.querySelector('.popover-body')?.textContent).toBe(
      '筛选条件',
    );
    expect(document.querySelector('.custom-content')?.className).toContain(
      'w-72',
    );
    expect(document.querySelector('.custom-content')?.className).toContain(
      'data-[side=bottom]:slide-in-from-top-2',
    );
  });

  it('关闭时不渲染浮层内容', /** 关闭仍渲染会让页面出现残留浮层。 */ async () => {
    mounted = mountPopover(false);
    await nextTick();

    expect(document.querySelector('.popover-body')).toBeNull();
    expect(mounted.find('.popover-body').exists()).toBe(false);
  });
});
