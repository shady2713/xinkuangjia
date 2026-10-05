/**
 * 内容区加载动画外壳（basic/content/content-spinner.vue）真实加载态回归。
 *
 * 该外壳把 useContentSpinner 的路由加载态接到 VbenSpinner 上：接线断开会让路由切换期间不显示
 * 加载动画（用户只看到空白内容区），或加载结束动画不消失（内容被遮罩长期挡住）。用例在真实内存
 * 路由上挂载真实组件并触发真实导航，断言真实 DOM 中加载动画的出现与消失。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { VbenSpinner } from '@vben-core/shadcn-ui';

import { describe, expect, it, vi } from 'vitest';

import ContentSpinner from './content-spinner.vue';

/** 路由目标组件：导航只需真实完成，不渲染业务内容。 */
const RouteView = defineComponent({
  name: 'RouteView',
  /** 渲染最小宿主节点，证明路由导航真实落地。 */
  render: () => h('div', { 'data-test': 'route-view' }),
});

/**
 * 创建含首屏、普通页与已加载页的真实内存路由，并停在首屏。
 * @returns 已完成就绪导航的真实 router 实例。
 */
async function createReadyRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: RouteView, name: 'home', path: '/' },
      { component: RouteView, name: 'page', path: '/page' },
      {
        component: RouteView,
        meta: { loaded: true, title: '已加载页' },
        name: 'loaded',
        path: '/loaded',
      },
    ],
  });
  await router.push('/');
  await router.isReady();
  return router;
}

describe('内容区加载动画外壳', /** 动画不出现会让页面切换看起来卡死，不消失会长期遮住内容。 */ () => {
  it('导航期间显示加载动画并在最小显示时间后隐藏', /** 加载反馈的开关时机是用户判断页面是否在加载的唯一依据。 */ async () => {
    const router = await createReadyRouter();
    const wrapper = mount(ContentSpinner, { global: { plugins: [router] } });
    const spinner = wrapper.findComponent(VbenSpinner);

    expect(spinner.props('spinning')).toBe(false);
    expect(wrapper.find('.loader').exists()).toBe(false);

    await router.push('/page');
    await nextTick();

    // 加载态刚置位时动画尚未到最小加载时间，遮罩仍处于不可见状态。
    expect(spinner.props('spinning')).toBe(true);
    expect(spinner.classes()).toContain('invisible');

    await vi.waitFor(
      /** 等待最小加载时间到期后转圈元素真实渲染并显示出来。 */ () => {
        expect(wrapper.find('.loader').exists()).toBe(true);
        expect(spinner.classes()).not.toContain('invisible');
      },
      { timeout: 1000 },
    );

    await vi.waitFor(
      /** 等待最小显示时间到期后加载态与动画一起关闭。 */ () => {
        expect(spinner.props('spinning')).toBe(false);
        expect(spinner.classes()).toContain('invisible');
      },
      { timeout: 2000 },
    );

    wrapper.unmount();
  });

  it('进入已加载页面不显示加载动画', /** 返回缓存页时再闪一次动画会让用户误以为页面重新加载。 */ async () => {
    const router = await createReadyRouter();
    const wrapper = mount(ContentSpinner, { global: { plugins: [router] } });
    const spinner = wrapper.findComponent(VbenSpinner);

    await router.push('/loaded');

    expect(spinner.props('spinning')).toBe(false);
    expect(wrapper.find('.loader').exists()).toBe(false);

    wrapper.unmount();
  });
});
