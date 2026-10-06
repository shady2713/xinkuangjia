/**
 * 默认偏好的契约测试：锁定语言切换与时区组件默认关闭，并快照整个默认值对象。
 * 用于防止默认值被无意改动；偏好更新、持久化与 CSS 变量写入不在本测试范围。
 */
import { describe, expect, it } from 'vitest';

import { defaultPreferences } from '../src/config';

describe('defaultPreferences immutability test', () => {
  it('disables language and timezone widgets by default', () => {
    expect(defaultPreferences.widget.languageToggle).toBe(false);
    expect(defaultPreferences.widget.timezone).toBe(false);
  });

  it('should not modify the config object', () => {
    expect(defaultPreferences).toMatchSnapshot();
  });
});
