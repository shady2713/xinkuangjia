/**
 * 提示内容（shadcn-ui 的 ui/tooltip 的 TooltipContent）内容与默认定位回归。
 *
 * 提示内容承载按钮说明：只在提示打开时渲染，默认从右侧弹出并与触发元素保持 5px 间距，
 * 调用方的 class 必须与内置样式合并。定位或样式合并写错会让提示贴住触发元素或被裁掉。
 * 用例真实挂载 reka-ui 的提示根节点，读取传送后的真实 DOM 节点。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui';
import { afterEach, describe, expect, it } from 'vitest';

import TooltipContent from './TooltipContent.vue';

/** 每个用例挂载的提示宿主，用例结束后统一卸载以清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载提示并清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

/**
 * 挂载提示。
 * @param open 是否以打开状态挂载。
 * @returns 已挂载的提示宿主包装器。
 */
function mountTooltip(open: boolean) {
  return mount(
    h(
      TooltipProvider,
      {},
      {
        /** 渲染提示根节点。 */
        default: () =>
          h(
            TooltipRoot,
            { open },
            {
              /** 渲染触发件与提示内容。 */
              default: () => [
                h(
                  TooltipTrigger,
                  {},
                  {
                    /** 触发件文案。 */
                    default: () => '说明入口',
                  },
                ),
                h(
                  TooltipContent,
                  { class: 'custom-tooltip' },
                  {
                    /** 提示文案。 */
                    default: () => '这是字段说明',
                  },
                ),
              ],
            },
          ),
      },
    ),
  );
}

describe('提示内容渲染与定位', /** 内容与定位决定用户能否看清按钮含义。 */ () => {
  it('打开时渲染内容并合并调用方 class', /** 内容未渲染会让提示为空，用户看不到说明。 */ async () => {
    mounted = mountTooltip(true);
    await nextTick();
    await nextTick();

    const content = document.querySelector('.custom-tooltip');
    expect(content).not.toBeNull();
    // 只渲染一个提示节点；节点内除可见文案外还有 reka-ui 的无障碍副本，测试环境无样式表隐藏它。
    expect(document.querySelectorAll('.custom-tooltip')).toHaveLength(1);
    expect(content?.textContent).toContain('这是字段说明');
    expect(content?.className).toContain('rounded-sm');
    expect(content?.className).toContain('z-popup');
    expect(content?.dataset.side).toBe('right');
    // 首帧直接打开时 reka-ui 用 instant-open 跳过进入动画，状态串仍表示已打开。
    expect(content?.dataset.state).toContain('open');
  });

  it('关闭时不渲染提示内容', /** 关闭仍渲染会在页面上留下残留提示。 */ async () => {
    mounted = mountTooltip(false);
    await nextTick();

    expect(document.querySelector('.custom-tooltip')).toBeNull();
  });

  it('传入 side 时按调用方方向弹出', /** 方向写死会让靠近右边缘的提示被裁掉。 */ async () => {
    mounted = mount(
      h(
        TooltipProvider,
        {},
        {
          /** 渲染朝上的提示。 */
          default: () =>
            h(
              TooltipRoot,
              { open: true },
              {
                /** 渲染触发件与提示内容。 */
                default: () => [
                  h(
                    TooltipTrigger,
                    {},
                    {
                      /** 触发件文案。 */
                      default: () => '说明入口',
                    },
                  ),
                  h(
                    TooltipContent,
                    { class: 'top-tooltip', side: 'top' },
                    {
                      /** 提示文案。 */
                      default: () => '朝上提示',
                    },
                  ),
                ],
              },
            ),
        },
      ),
    );
    await nextTick();
    await nextTick();

    expect(document.querySelector('.top-tooltip')?.dataset.side).toBe('top');
  });
});
