/**
 * 抽屉触发件与关闭件（shadcn-ui 的 ui/sheet）回归。
 *
 * 抽屉与对话框共用 reka-ui 的开合原语：触发件必须在点击后请求打开，关闭件必须在点击后请求
 * 关闭；调用方传入的 class 需要透传到真实按钮。开关入口失效会让用户无法展开或收起抽屉。
 * 用例真实挂载 reka-ui 的对话框根节点，读取真实 DOM 属性与开合结果。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { DialogRoot } from 'reka-ui';
import { afterEach, describe, expect, it } from 'vitest';

import SheetClose from './SheetClose.vue';
import SheetTrigger from './SheetTrigger.vue';

/** 每个用例挂载的抽屉宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载抽屉宿主，避免残留节点影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

describe('抽屉开关入口', /** 开关入口是抽屉唯一的手动控制方式。 */ () => {
  it('点击触发件请求打开抽屉', /** 触发件未绑定开合状态会让入口点了没反应。 */ async () => {
    let openCount = 0;
    mounted = mount(
      h(
        DialogRoot,
        {
          /** 记录开合状态变化次数。 */
          'onUpdate:open': () => {
            openCount += 1;
          },
        },
        {
          /** 渲染触发件。 */
          default: () =>
            h(
              SheetTrigger,
              { class: 'custom-trigger' },
              {
                /** 触发件文案。 */
                default: () => '展开',
              },
            ),
        },
      ),
    );

    await mounted.find('button').trigger('click');

    expect(openCount).toBe(1);
    expect(mounted.find('button').classes()).toContain('custom-trigger');
  });

  it('点击关闭件请求关闭抽屉', /** 关闭件失效会让用户只能靠 ESC 退出。 */ async () => {
    let lastOpen: boolean | undefined;
    mounted = mount(
      h(
        DialogRoot,
        {
          open: true,
          /** 记录开合状态更新。 */
          'onUpdate:open': (value: boolean) => {
            lastOpen = value;
          },
        },
        {
          /** 渲染关闭件。 */
          default: () =>
            h(
              SheetClose,
              {},
              {
                /** 关闭件文案。 */
                default: () => '收起',
              },
            ),
        },
      ),
    );
    await nextTick();

    await mounted.find('button').trigger('click');

    expect(lastOpen).toBe(false);
    expect(mounted.find('button').text()).toBe('收起');
  });
});
