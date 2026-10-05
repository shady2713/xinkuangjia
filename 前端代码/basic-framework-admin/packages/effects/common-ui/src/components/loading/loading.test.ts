/**
 * 局部加载容器（common-ui 的 components/loading/loading.vue）包裹与参数透传回归。
 *
 * 组件把内容包进相对定位容器，再把加载参数交给核心加载指示器：相对定位丢失会让加载遮罩
 * 脱离内容区域铺满整页，最小加载时间、加载开关与文案未透传会让调用方无法控制加载时机与
 * 提示；图标插槽缺失时核心指示器要回退到默认动画，插槽条件写反会让自定义图标永远不显示。
 * 用例真实挂载组件，真实等待最小加载计时器触发，并断言真实 DOM。
 */
import { mount } from '@vue/test-utils';

import { afterEach, describe, expect, it, vi } from 'vitest';

import Loading from './loading.vue';

/** 每个用例挂载的组件，用例结束后统一卸载，避免残留影响后续用例。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载组件，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

describe('局部加载容器包裹', /** 容器定位与内容渲染决定加载遮罩是否覆盖正确区域。 */ () => {
  it('包裹内容并合并调用方 class', /** 相对定位丢失会让加载遮罩铺满整个页面。 */ () => {
    mounted = mount(Loading, {
      props: { class: 'custom-loading' },
      slots: { default: '<div class="loading-body">DUMMY-表格内容</div>' },
    });

    const container = mounted.find('.custom-loading');
    expect(container.classes()).toContain('relative');
    expect(container.classes()).toContain('min-h-20');
    expect(container.find('.loading-body').text()).toBe('DUMMY-表格内容');
  });

  it('未开启加载时遮罩隐藏且不渲染旋转动画', /** 默认态残留动画会让静态内容看起来一直在加载。 */ () => {
    mounted = mount(Loading, {
      props: { text: 'DUMMY-加载中' },
      slots: { default: '<div class="loading-body">DUMMY-表格内容</div>' },
    });

    const overlay = mounted.find('.z-100');
    expect(overlay.exists()).toBe(true);
    // 文案随遮罩一起被隐藏，遮罩本身收到 invisible 才不会挡住内容区域。
    expect(overlay.classes()).toContain('invisible');
    expect(overlay.classes()).toContain('opacity-0');
    expect(mounted.find('.dot').exists()).toBe(false);
  });
});

describe('局部加载参数透传', /** 加载开关与文案不透传会让调用方失去对加载态的控制。 */ () => {
  it('开启加载后显示遮罩与文案', /** 参数未透传会让加载动画不出现或文案丢失。 */ async () => {
    mounted = mount(Loading, {
      props: { minLoadingTime: 0, spinning: true, text: 'DUMMY-加载中' },
      slots: { default: '<div class="loading-body">DUMMY-表格内容</div>' },
    });

    await vi.waitFor(
      /** 等待最小加载计时器真实触发，遮罩从隐藏切到显示。 */ () => {
        expect(mounted?.find('.z-100').classes()).not.toContain('invisible');
      },
    );

    expect(mounted.find('.z-100').text()).toContain('DUMMY-加载中');
    // 遮罩显示期间内容仍要在容器里，否则加载结束后数据区域会整块消失。
    expect(mounted.find('.loading-body').text()).toBe('DUMMY-表格内容');
  });

  it('提供图标插槽时渲染自定义图标', /** 图标插槽条件写反会让调用方传入的图标永远不显示。 */ async () => {
    mounted = mount(Loading, {
      props: { minLoadingTime: 0, spinning: true },
      slots: {
        default: '<div class="loading-body">DUMMY-表格内容</div>',
        icon: '<i class="custom-loading-icon"></i>',
      },
    });

    await vi.waitFor(
      /** 等待计时器触发后再渲染图标插槽。 */ () => {
        expect(mounted?.find('.custom-loading-icon').exists()).toBe(true);
      },
    );

    // 自定义图标出现时默认动画不再渲染，避免两套加载动画叠加。
    expect(mounted.find('.z-100 .dot').exists()).toBe(false);
  });

  it('未提供图标插槽时回退到默认动画', /** 回退缺失会让加载遮罩只剩底色，用户看不出正在加载。 */ async () => {
    mounted = mount(Loading, {
      props: { minLoadingTime: 0, spinning: true },
      slots: { default: '<div class="loading-body">DUMMY-表格内容</div>' },
    });

    await vi.waitFor(
      /** 等待计时器触发后再渲染默认动画。 */ () => {
        expect(mounted?.find('.z-100 .dot').exists()).toBe(true);
      },
    );

    expect(mounted.find('.custom-loading-icon').exists()).toBe(false);
  });
});
