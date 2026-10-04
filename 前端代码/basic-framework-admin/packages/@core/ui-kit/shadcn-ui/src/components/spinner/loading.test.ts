/**
 * 加载指示器（shadcn-ui 的 spinner/loading.vue）延迟显示与过渡收尾回归。
 *
 * 该组件被弹窗、抽屉与提示框在提交或加载时渲染：它按 `minLoadingTime` 延迟显示旋转点，
 * 并在过渡结束时收起已完成的指示器。延迟或收尾写错会让加载态提前闪烁或永久留在页面上，
 * 因此用例用真实挂载、真实 `setTimeout` 与真实 `transitionend` 断言旋转点的出现与消失。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import VbenLoading from './loading.vue';

/**
 * 等待一个宏任务，让组件内部的最小加载延迟计时器真实触发。
 * @param delayMs 等待毫秒数，必须大于被测延迟。
 * @returns 计时结束后的 Promise。
 */
function waitTimer(delayMs = 5) {
  return new Promise(
    /** 用真实计时器释放等待，避免用固定休眠掩盖未触发的流程。 */ (resolve) => {
      setTimeout(resolve, delayMs);
    },
  );
}

describe('vbenLoading 加载指示器', /** 加载指示器的显示时机与收起时机直接影响用户可见的加载反馈。 */ () => {
  it('未开启加载时不渲染旋转点', /** 默认状态必须保持安静，不能残留加载动画。 */ async () => {
    const wrapper = mount(VbenLoading);

    expect(wrapper.find('.dot').exists()).toBe(false);
    await wrapper.trigger('transitionend');
    expect(wrapper.find('.dot').exists()).toBe(false);
    wrapper.unmount();
  });

  it('开启加载并在最小延迟后渲染旋转点', /** 延迟到点才显示可以避免短暂请求产生闪烁。 */ async () => {
    const wrapper = mount(VbenLoading, {
      props: { minLoadingTime: 0, spinning: true },
    });

    await waitTimer();

    expect(wrapper.find('.dot').exists()).toBe(true);
    expect(wrapper.findAll('.dot i')).toHaveLength(4);
    // 仍在加载时过渡结束不得收起旋转点。
    await wrapper.trigger('transitionend');
    expect(wrapper.find('.dot').exists()).toBe(true);
    wrapper.unmount();
  });

  it('最小延迟未到时保持不渲染', /** 提前渲染会让短请求出现闪烁的加载动画。 */ async () => {
    const wrapper = mount(VbenLoading, {
      props: { minLoadingTime: 1000, spinning: true },
    });

    await waitTimer();

    expect(wrapper.find('.dot').exists()).toBe(false);
    wrapper.unmount();
  });

  it('加载结束后过渡结束收起旋转点', /** 收起延迟会让加载动画残留在已完成的界面上。 */ async () => {
    const wrapper = mount(VbenLoading, {
      props: { minLoadingTime: 0, spinning: true },
    });
    await waitTimer();
    expect(wrapper.find('.dot').exists()).toBe(true);

    await wrapper.setProps({ spinning: false });
    await wrapper.trigger('transitionend');

    expect(wrapper.find('.dot').exists()).toBe(false);
    expect(wrapper.classes()).toContain('invisible');
    wrapper.unmount();
  });

  it('加载被取消后到达的延迟回调不渲染旋转点', /** 计时器必须被清理，否则取消加载后动画仍会弹出。 */ async () => {
    const wrapper = mount(VbenLoading, {
      props: { minLoadingTime: 50, spinning: true },
    });

    await wrapper.setProps({ spinning: false });
    await waitTimer(60);

    expect(wrapper.find('.dot').exists()).toBe(false);
    wrapper.unmount();
  });

  it('渲染传入的加载文案', /** 加载文案用于说明当前正在执行的操作。 */ async () => {
    const wrapper = mount(VbenLoading, {
      props: { minLoadingTime: 0, spinning: true, text: '正在加载数据' },
    });
    await waitTimer();

    expect(wrapper.text()).toContain('正在加载数据');
    wrapper.unmount();
  });
});
