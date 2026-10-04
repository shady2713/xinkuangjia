/**
 * 应用根组件（app.vue）的真实装配回归。
 *
 * 该组件是 Element Plus 的配置注入点：把应用级语言包交给 ElConfigProvider、挂载路由视图，
 * 并在启动时把主题令牌转换成 Element Plus 的设计变量。
 * 用例使用真实 vue-router（内存历史）与真实 ElConfigProvider，断言路由内容、语言包引用与设计变量落点。
 */
import type { Router } from 'vue-router';

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';

import { ElConfigProvider } from 'element-plus';
import { describe, expect, it } from 'vitest';

import { elementLocale } from '#/locales';

import App from '../app.vue';

/** 路由视图的标记组件，用于证明 RouterView 渲染的是真实匹配结果。 */
const RouteMarker = defineComponent({
  name: 'RouteMarker',
  /** 渲染带标记的节点，便于按选择器断言。 */
  render: () => h('div', { class: 'route-marker' }, '路由视图内容'),
});

/**
 * 建立只有单条路由的真实路由器并完成首次导航。
 * @returns 已就绪的路由器。
 */
async function createReadyRouter(): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ component: RouteMarker, name: 'Home', path: '/' }],
  });
  await router.push('/');
  await router.isReady();
  return router;
}

/** 主题令牌读取的 CSS 变量；框架在启动前由偏好流程写入，测试按同一口径预置。 */
const THEME_VARIABLES: Record<string, string> = {
  '--accent': '240 5% 96%',
  '--background': '0 0% 100%',
  '--background-deep': '0 0% 100%',
  '--border': '240 6% 90%',
  '--card': '0 0% 100%',
  '--destructive-200': '0 93% 94%',
  '--destructive-300': '0 96% 89%',
  '--destructive-400': '0 96% 80%',
  '--destructive-50': '0 86% 97%',
  '--destructive-500': '0 84% 60%',
  '--destructive-600': '0 72% 51%',
  '--destructive-700': '0 74% 42%',
  '--destructive-800': '0 70% 35%',
  '--destructive-900': '0 63% 31%',
  '--destructive-950': '0 60% 20%',
  '--foreground': '240 10% 4%',
  '--info': '240 5% 46%',
  '--popover': '0 0% 100%',
  '--primary': '212 100% 45%',
  '--primary-100': '214 95% 93%',
  '--primary-200': '213 97% 87%',
  '--primary-300': '212 96% 78%',
  '--primary-400': '213 94% 68%',
  '--primary-50': '214 100% 97%',
  '--primary-500': '212 100% 45%',
  '--primary-600': '221 83% 53%',
  '--primary-700': '224 76% 48%',
  '--primary-800': '226 71% 40%',
  '--primary-900': '224 64% 33%',
  '--primary-950': '226 57% 21%',
  '--primary-foreground': '0 0% 100%',
  '--radius': '0.5rem',
  '--success': '142 71% 45%',
  '--success-600': '142 76% 36%',
  '--success-700': '142 77% 28%',
  '--success-800': '143 64% 24%',
  '--warning': '38 92% 50%',
  '--warning-600': '32 95% 44%',
  '--warning-700': '26 90% 37%',
  '--warning-800': '23 83% 31%',
};

describe('应用根组件装配（app.vue）', /** 配置注入、路由视图与设计令牌三条装配链。 */ () => {
  it('渲染真实路由匹配结果并注入应用语言包', /** 根组件必须把路由视图放进 Element Plus 配置里，并使用应用导出的语言包。 */ async () => {
    const router = await createReadyRouter();
    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.find('.route-marker').text()).toBe('路由视图内容');
    // ElConfigProvider 不渲染包裹元素，按组件属性核对注入的语言包引用。
    expect(wrapper.findComponent(ElConfigProvider).props('locale')).toBe(
      elementLocale.value,
    );
    expect(wrapper.findComponent(RouterView).exists()).toBe(true);
  });

  it('启动时把主题令牌写入 Element Plus 设计变量', /** 缺少令牌写入，Element Plus 组件会退回默认配色而不是跟随主题。 */ async () => {
    const root = document.documentElement;
    const previous = new Map<string, string>();
    for (const [name, value] of Object.entries(THEME_VARIABLES)) {
      previous.set(name, root.style.getPropertyValue(name));
      root.style.setProperty(name, value);
    }

    try {
      const router = await createReadyRouter();
      const wrapper = mount(App, { global: { plugins: [router] } });
      await flushPromises();

      const designStyles = document.querySelector('#__vben_design_styles__');
      expect(designStyles).not.toBe(null);
      expect(designStyles?.textContent).toContain('--el-color-primary:');
      expect(designStyles?.textContent).toContain('--el-border-radius-base:');

      wrapper.unmount();
    } finally {
      for (const [name, value] of previous) {
        if (value) {
          root.style.setProperty(name, value);
        } else {
          root.style.removeProperty(name);
        }
      }
      document.querySelector('#__vben_design_styles__')?.remove();
    }
  });
});
