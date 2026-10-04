/** 校验“关于”页面包装组件的注册名与子组件装配，防止路由懒加载拿到错误页面或丢失主体。 */
import { mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';

import AboutPage from './index.vue';

vi.mock(
  '@vben/common-ui',
  /** 关于页主体依赖构建期元数据全局量，这里用最小替身隔离，只验证包装契约。 */ () => ({
    /** 渲染可识别的锚点，便于确认包装页确实把主体挂载出来。 */
    About: {
      name: 'AboutUiStub',
      template: '<div data-test="about-body" />',
    },
  }),
);

describe('关于页面包装组件', /** 该组件是 /about 路由的懒加载目标，注册名与模板装配都属于可观察契约。 */ () => {
  it('注册名固定为 About', /** 名称用于路由缓存与调试定位，改名会让缓存命中失效。 */ () => {
    expect(AboutPage.name).toBe('About');
  });

  it('挂载后渲染一个不带属性的关于页主体', /** 模板必须原样输出主体组件，且当前没有向主体传递任何属性。 */ () => {
    const wrapper = mount(AboutPage);
    const body = wrapper.find('[data-test="about-body"]');
    expect(body.exists()).toBe(true);
    expect(body.attributes()).toEqual({ 'data-test': 'about-body' });
    expect(wrapper.findAll('[data-test="about-body"]')).toHaveLength(1);
  });
});
