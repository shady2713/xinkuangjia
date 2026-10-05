/**
 * 主题变量更新的兜底分支（preferences 的 update-css-variables）真实行为回归。
 *
 * 更新主色变量前会再确认偏好里仍然带着 theme：如果主题对象在更新过程中消失（外部把偏好
 * 清空、或读取时主题已被替换），函数必须直接返回。缺少这条兜底，页面会在主题已被移除时
 * 继续按 undefined 取属性而抛错，整块主题初始化中断，界面停在半套样式上。
 * 用例调用真实的 updateCSSVariables 入口，断言不抛错、且没有写入任何主色变量。
 */
import type { Preferences } from '../src/types';

import { describe, expect, it } from 'vitest';

import { updateCSSVariables } from '../src/update-css-variables';

/** 主色变量名：兜底分支命中时不允许被写入。 */
const PRIMARY_VARIABLE = '--primary';

describe('主题变量更新的兜底分支', /** 主题消失时只能安全退出，不能让主题初始化整块抛错。 */ () => {
  it('主题对象在读取期间消失时不更新主色变量', /** 主题被清空是真实可发生的状态，兜底必须拦住后续取属性。 */ () => {
    const root = document.documentElement;
    root.style.removeProperty(PRIMARY_VARIABLE);
    /** 主题读取次数，用于确认兜底发生在第二次读取之后。 */
    let themeReads = 0;
    // 只在第一次读取时交出真实主题，之后模拟主题在更新过程中被清空。
    const preferences = {
      /**
       * 主题读取入口：首次读取交出真实主题，之后模拟主题在更新过程中被清空。
       * @returns 第一次是带主色的主题对象，之后为 undefined。
       */
      get theme() {
        themeReads += 1;
        return themeReads === 1
          ? { colorPrimary: 'hsl(212 100% 45%)' }
          : undefined;
      },
    } as unknown as Preferences;

    expect(
      /** 真实调用主题变量更新入口。 */ () => updateCSSVariables(preferences),
    ).not.toThrow();

    expect(themeReads).toBe(2);
    expect(root.style.getPropertyValue(PRIMARY_VARIABLE)).toBe('');
  });
});
