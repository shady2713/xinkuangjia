/** 校验 404 兜底页面包装组件把真实状态码交给统一兜底视图，避免未匹配路由展示成其他错误。 */
import { mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';

import NotFoundPage from './not-found.vue';

vi.mock(
  '@vben/common-ui',
  /** 统一兜底视图依赖图标与国际化，这里用最小替身隔离，只验证状态码透传。 */ () => ({
    /** 把收到的 status 属性渲染成可断言文本，用于确认包装页传值。 */
    Fallback: {
      name: 'FallbackStub',
      props: { status: { default: '', type: String } },
      template: '<div data-test="fallback" :data-status="status" />',
    },
  }),
);

describe('404 未匹配路由兜底页面', /** 全局通配路由会落到该页面，状态码写错会让用户看到误导性的错误文案。 */ () => {
  it('注册名固定为 Fallback404', /** 名称用于路由与调试定位，必须与 403 包装页区分。 */ () => {
    expect(NotFoundPage.name).toBe('Fallback404');
  });

  it('向兜底视图传入 404 状态码', /** 断言渲染结果中的实际取值，而不是仅检查模板源码文本。 */ () => {
    const wrapper = mount(NotFoundPage);
    const fallback = wrapper.find('[data-test="fallback"]');
    expect(fallback.exists()).toBe(true);
    expect(fallback.attributes('data-status')).toBe('404');
  });
});
