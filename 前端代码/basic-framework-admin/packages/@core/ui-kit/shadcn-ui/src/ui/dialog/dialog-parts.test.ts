/**
 * 对话框基础件（shadcn-ui 的 ui/dialog）开关入口与滚动内容回归。
 *
 * 触发件与关闭件是对话框的开关入口：触发件必须在点击后请求打开，关闭件必须在点击后请求
 * 关闭；滚动内容件用于长表单，遮罩层要在内容超出视口时允许滚动，点击遮罩本身是否关闭由
 * 指针落点是否越过内容边界决定。用例真实挂载 reka-ui 的对话框根节点，读取真实开合事件、
 * DOM 属性与遮罩样式。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { DialogRoot, DialogTitle } from 'reka-ui';
import { afterEach, describe, expect, it } from 'vitest';

import DialogClose from './DialogClose.vue';
import DialogScrollContent from './DialogScrollContent.vue';
import DialogTrigger from './DialogTrigger.vue';

/** 每个用例挂载的对话框宿主，用例结束后统一卸载以清理 teleport 到 body 的节点。 */
let mounted: ReturnType<typeof mount> | undefined;

/** 用例创建的遮罩外点击目标，用例结束后一并清理。 */
let outsideTarget: HTMLElement | undefined;

afterEach(
  /** 卸载对话框并清理传送节点与遮罩外目标，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    outsideTarget?.remove();
    outsideTarget = undefined;
    document.body.innerHTML = '';
  },
);

/**
 * 等待一个宏任务，让 reka-ui 注册文档级指针监听。
 * @returns 宏任务结束后的 Promise。
 */
function flushTask() {
  return new Promise(
    /** 用真实计时器释放等待，避免掩盖未注册的监听。 */ (resolve) => {
      setTimeout(resolve, 0);
    },
  );
}

/**
 * 在内容之外的节点上派发一次指针按下事件。
 * @param offsetX 指针相对目标左边界的横向偏移，用于越过内容宽度。
 * @param offsetY 指针相对目标上边界的纵向偏移，用于越过内容高度。
 * @returns 派发完成后的 Promise。
 */
async function pointerDownOutside(offsetX: number, offsetY: number) {
  outsideTarget = document.createElement('div');
  document.body.append(outsideTarget);
  const event = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'offsetX', { value: offsetX });
  Object.defineProperty(event, 'offsetY', { value: offsetY });
  outsideTarget.dispatchEvent(event);
  await nextTick();
  await nextTick();
  await flushTask();
  await nextTick();
}

describe('对话框触发件与关闭件', /** 开关入口失效会让用户无法打开或关闭对话框。 */ () => {
  it('点击触发件请求打开对话框', /** 触发件未绑定开合状态会让入口点了没反应。 */ async () => {
    const openStates: unknown[] = [];
    mounted = mount(
      h(
        DialogRoot,
        {
          /** 记录开合状态更新。 */
          'onUpdate:open': (value: unknown) => {
            openStates.push(value);
          },
        },
        {
          /** 渲染触发件。 */
          default: () =>
            h(
              DialogTrigger,
              {},
              {
                /** 触发件文案。 */
                default: () => '打开',
              },
            ),
        },
      ),
    );
    await nextTick();

    await mounted.find('button').trigger('click');
    await nextTick();

    expect(openStates).toEqual([true]);
    expect(mounted.find('button').text()).toBe('打开');
    expect(mounted.find('button').attributes('aria-haspopup')).toBe('dialog');
    expect(mounted.find('button').attributes('data-state')).toBe('open');
  });

  it('点击关闭件请求关闭对话框', /** 关闭件失效会让用户只能靠 ESC 退出。 */ async () => {
    const openStates: unknown[] = [];
    mounted = mount(
      h(
        DialogRoot,
        {
          open: true,
          /** 记录开合状态更新。 */
          'onUpdate:open': (value: unknown) => {
            openStates.push(value);
          },
        },
        {
          /** 渲染关闭件。 */
          default: () =>
            h(
              DialogClose,
              { class: 'custom-close' },
              {
                /** 关闭件文案。 */
                default: () => '关闭',
              },
            ),
        },
      ),
    );
    await nextTick();

    await mounted.find('button').trigger('click');
    await nextTick();

    expect(openStates).toEqual([false]);
    expect(mounted.find('button').classes()).toContain('custom-close');
  });
});

describe('对话框滚动内容件', /** 长表单需要可滚动遮罩，否则超出视口的内容无法触达。 */ () => {
  /**
   * 挂载打开状态的滚动内容对话框。
   * @param openStates 记录开合状态变化的数组。
   * @returns 挂载后的对话框宿主包装器。
   */
  async function mountScrollDialog(openStates: unknown[] = []) {
    const wrapper = mount(
      h(
        DialogRoot,
        {
          open: true,
          /** 记录开合状态更新。 */
          'onUpdate:open': (value: unknown) => {
            openStates.push(value);
          },
        },
        {
          /** 渲染对话框标题与滚动内容。 */
          default: () => [
            h(
              DialogTitle,
              {},
              {
                /** 对话框标题文本。 */
                default: () => 'DUMMY-标题',
              },
            ),
            h(
              DialogScrollContent,
              { class: 'custom-scroll', zIndex: 1200 },
              {
                /** 对话框主体内容。 */
                default: () => h('span', { class: 'scroll-body' }, '主体内容'),
              },
            ),
          ],
        },
      ),
    );
    await nextTick();
    await nextTick();
    await flushTask();
    return wrapper;
  }

  it('渲染可滚动遮罩、关闭按钮与传入内容', /** 缺少关闭按钮会让用户无法退出，遮罩不可滚动会让长表单被截断。 */ async () => {
    mounted = await mountScrollDialog();

    const overlay = document.querySelector('.grid.place-items-center');
    expect(overlay).not.toBeNull();
    expect((overlay as HTMLElement).style.zIndex).toBe('1200');
    expect(overlay?.className).toContain('overflow-y-auto');
    expect(document.querySelector('.scroll-body')?.textContent).toBe(
      '主体内容',
    );
    expect(document.querySelector('.sr-only')?.textContent).toBe('Close');
    expect(document.querySelector('.custom-scroll')?.className).toContain(
      'max-w-lg',
    );
  });

  it('指针落在内容边界内时点击遮罩关闭对话框', /** 落在内容范围内的点击应视为真正的遮罩点击。 */ async () => {
    const openStates: unknown[] = [];
    mounted = await mountScrollDialog(openStates);

    await pointerDownOutside(0, 0);

    expect(openStates).toEqual([false]);
  });

  it('指针越过内容边界时不关闭对话框', /** 内容内部滚动条落在遮罩上时误关闭会让长表单输入丢失。 */ async () => {
    const openStates: unknown[] = [];
    mounted = await mountScrollDialog(openStates);

    await pointerDownOutside(5, 5);

    expect(openStates).toEqual([]);
    expect(document.querySelector('.scroll-body')).not.toBeNull();
  });
});
