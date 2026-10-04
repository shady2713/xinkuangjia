/** 应用偏好覆盖入口测试：验证各应用提供的覆盖对象被原样交给框架偏好合并。 */
import { describe, expect, it } from 'vitest';

import { defineOverridesPreferences } from './index';

describe('defineOverridesPreferences', /** 该入口只做类型收窄与透传，行为变化会影响所有应用的默认偏好。 */ () => {
  it('原样返回传入的覆盖对象', /** 框架按该对象合并默认偏好，任何改写都会让应用配置与预期不一致。 */ () => {
    const overrides = {
      app: { defaultHomePath: '/dashboard', name: '管理后台' },
      theme: { mode: 'dark' as const },
    };

    expect(defineOverridesPreferences(overrides)).toBe(overrides);
  });

  it('空对象同样可以透传', /** 应用可以不覆盖任何偏好，此时必须得到空对象而不是默认值。 */ () => {
    expect(defineOverridesPreferences({})).toEqual({});
  });

  it('嵌套对象保持引用而不是深拷贝', /** 覆盖对象由调用方独占，复制会破坏引用相等语义。 */ () => {
    const nested = { widget: { globalSearch: true } };

    expect(defineOverridesPreferences(nested).widget).toBe(nested.widget);
  });
});
