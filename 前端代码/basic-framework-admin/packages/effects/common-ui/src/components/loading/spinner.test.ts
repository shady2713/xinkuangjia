/**
 * 局部加载指示（effects/common-ui 的 components/loading/spinner）包裹与透传回归。
 *
 * 该组件把内容包进相对定位容器并把加载参数交给核心加载指示器：容器定位丢失会让加载遮罩脱离
 * 内容区域，参数未透传会让调用方无法控制加载时机。用例真实挂载组件并读取真实 DOM 与传入参数。
 */
import { mount } from '@vue/test-utils';

import { afterEach, describe, expect, it } from 'vitest';

import Spinner from './spinner.vue';

/** 每个用例挂载的组件，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载组件，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

describe('局部加载指示', /** 容器定位与参数透传决定加载遮罩是否覆盖正确区域。 */ () => {
  it('包裹内容并合并调用方 class', /** 相对定位丢失会让加载遮罩铺满整个页面。 */ () => {
    mounted = mount(Spinner, {
      props: { class: 'custom-spinner' },
      slots: { default: '<div class="spinner-body">表格内容</div>' },
    });

    const container = mounted.find('.custom-spinner');
    expect(container.classes()).toContain('relative');
    expect(container.classes()).toContain('min-h-20');
    expect(container.find('.spinner-body').text()).toBe('表格内容');
  });

  it('把加载状态与最小加载时间交给核心指示器', /** 参数未透传会让加载动画不显示或闪烁。 */ async () => {
    mounted = mount(Spinner, {
      props: { minLoadingTime: 0, spinning: true },
      slots: { default: '<div class="spinner-body">表格内容</div>' },
    });
    await new Promise(
      /** 等待最小加载延迟计时器真实触发。 */ (resolve) => {
        setTimeout(resolve, 10);
      },
    );

    // 核心指示器在开启加载后渲染覆盖层与旋转体，参数未透传时不会出现。
    expect(mounted.find('.loader').exists()).toBe(true);
    expect(mounted.find('.spinner-body').exists()).toBe(true);
  });

  it('未开启加载时不渲染旋转体', /** 默认态残留动画会让静态内容看起来一直在加载。 */ () => {
    mounted = mount(Spinner, {
      slots: { default: '<div class="spinner-body">表格内容</div>' },
    });

    expect(mounted.find('.loader').exists()).toBe(false);
  });
});
