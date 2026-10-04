/**
 * 滚动锁定（useScrollLock）的真实行为回归。
 *
 * 覆盖两条只在真实挂载下出现的契约：
 * ① 页面需要滚动条时锁定滚动，并把滚动条宽度补偿到 body 与固定定位节点上；
 * ② 卸载时恢复固定定位节点的内联样式与过渡动画，清理锁定期写入的补偿。
 * 另外确认页面不需要滚动条时组件不写入任何补偿样式。
 * 元素尺寸由排版决定，测试环境没有排版，因此只在测试里接管 offsetWidth 与 scrollHeight 这两个测量接口。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCROLL_FIXED_CLASS, useScrollLock } from '../use-scroll-lock';

/** 测试环境中的滚动条宽度，用于区分“写入了补偿”和“写入 0”。 */
const SCROLLBAR_WIDTH = 15;

/** 被测组合式函数的最小宿主组件，只负责在挂载期调用一次并随组件卸载释放。 */
const ScrollLockHost = defineComponent({
  name: 'ScrollLockHost',
  /**
   * 调用被测组合式函数并渲染占位节点。
   * @returns 渲染占位节点的渲染函数，随组件卸载触发组合式函数的清理逻辑。
   */
  setup() {
    useScrollLock();
    /** 渲染占位节点的渲染函数。 */
    const render = () => h('div', { class: 'scroll-host' });
    return render;
  },
});

/**
 * 让页面报告“需要滚动条”。
 * happy-dom 不排版，documentElement 的 scrollHeight 恒为 0，必须按真实判定口径接管。
 */
function stubScrollablePage(): void {
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    /** 返回大于窗口高度的滚动高度，使页面被判定为需要滚动条。 */
    get: () => 10_000,
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    /** 模拟测量节点宽度：外层带 overflow:scroll 的节点比内层宽出滚动条宽度。 */ function (
      this: HTMLElement,
    ) {
      return this.style.overflow === 'scroll' ? SCROLLBAR_WIDTH : 0;
    },
  );
}

/**
 * 创建带滚动锁定标记的固定定位节点。
 * @returns 已挂到 body 上的固定定位节点，调用方负责移除。
 */
function createFixedNode(): HTMLElement {
  const node = document.createElement('div');
  node.className = SCROLL_FIXED_CLASS;
  node.style.transition = 'all 0.3s ease';
  document.body.append(node);
  return node;
}

describe('useScrollLock 滚动补偿', /** 锁定与解锁期对 body 及固定节点的真实写入。 */ () => {
  afterEach(
    /** 恢复测量接口并清理本例写入的样式与节点。 */ () => {
      vi.restoreAllMocks();
      // scrollHeight 是直接定义的属性，不受 restoreAllMocks 影响，必须显式删除。
      delete (document.documentElement as unknown as { scrollHeight?: number })
        .scrollHeight;
      document.body.removeAttribute('style');
      for (const node of document.querySelectorAll(`.${SCROLL_FIXED_CLASS}`)) {
        node.remove();
      }
    },
  );

  it('锁定滚动时把滚动条宽度补偿到 body 与固定节点', /** 隐藏滚动条会让固定定位节点横向跳动，必须同时补偿 body 与固定节点。 */ async () => {
    stubScrollablePage();
    const fixedNode = createFixedNode();

    const wrapper = mount(ScrollLockHost);
    await nextTick();

    expect(document.body.style.paddingRight).toBe(`${SCROLLBAR_WIDTH}px`);
    expect(fixedNode.style.paddingRight).toBe(`${SCROLLBAR_WIDTH}px`);
    // 锁定期禁用过渡，避免补偿宽度被动画放大成抖动；原值留存在数据集里。
    expect(fixedNode.style.transition).toBe('none');
    expect(fixedNode.dataset.transition).toBe('all 0.3s ease');

    wrapper.unmount();
  });

  it('卸载时恢复固定节点样式并清除补偿', /** 解锁必须清掉补偿宽度并把过渡动画还原为锁定前的值。 */ async () => {
    stubScrollablePage();
    const fixedNode = createFixedNode();
    const wrapper = mount(ScrollLockHost);
    await nextTick();

    wrapper.unmount();
    await nextTick();
    await new Promise(
      /** 等待一次动画帧，让过渡样式的恢复在帧回调中生效。 */ (resolve) => {
        requestAnimationFrame(
          /** 帧回调里结束等待。 */ () => resolve(undefined),
        );
      },
    );

    expect(fixedNode.style.paddingRight).toBe('');
    expect(document.body.style.paddingRight).toBe('');
    expect(fixedNode.style.transition).toBe('all 0.3s ease');
  });

  it('页面不需要滚动条时不写入任何补偿', /** 不占据滚动条的布局写入补偿会引入多余内边距。 */ async () => {
    const wrapper = mount(ScrollLockHost);
    await nextTick();

    expect(document.body.style.paddingRight).toBe('');
    expect(document.querySelectorAll(`.${SCROLL_FIXED_CLASS}`)).toHaveLength(0);

    wrapper.unmount();
    await nextTick();
    expect(document.body.style.paddingRight).toBe('');
  });

  it('没有固定定位节点时只补偿 body', /** 缺少固定定位节点属于常规情况，锁定不能因此失败。 */ async () => {
    stubScrollablePage();

    const wrapper = mount(ScrollLockHost);
    await nextTick();

    expect(document.body.style.paddingRight).toBe(`${SCROLLBAR_WIDTH}px`);

    wrapper.unmount();
    await nextTick();
    expect(document.body.style.paddingRight).toBe('');
  });
});
