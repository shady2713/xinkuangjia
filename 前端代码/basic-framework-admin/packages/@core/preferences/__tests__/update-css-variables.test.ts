/**
 * 偏好主题变量写入文档根节点的真实行为回归。
 *
 * 覆盖主题类名与 data-theme 写入、圆角与字号变量、内置主题缺省色与自定义色并列时的主色计算，
 * 以及文档根节点缺失时的防御分支。断言均读取真实 documentElement 的类名、数据集与内联样式。
 */
import type { Preferences } from '../src/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isDarkTheme, updateCSSVariables } from '../src/update-css-variables';

/**
 * 把主题片段包装成入参要求的完整偏好形状。
 * 未参与 CSS 变量计算的字段不会在实现里被读取，因此只提供 theme 不改变被测契约。
 * @param theme 本次要写入文档根节点的主题片段。
 * @returns 只带 theme 的偏好对象。
 */
function preferencesWithTheme(theme: Record<string, unknown>): Preferences {
  return { theme } as unknown as Preferences;
}

/** 读取文档根节点当前的内联 CSS 变量值，空字符串表示未写入。 */
function rootStyleValue(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

/**
 * 读取共享工具注入的 `:root` 样式表文本。
 * 色阶变量（如 `--warning-500`）写入该样式节点而不是根节点内联样式，两处都要核对。
 * @returns 样式表文本；尚未注入时返回空字符串。
 */
function injectedStyleText(): string {
  const style = document.querySelector('#__vben-styles__');
  return style?.textContent ?? '';
}

/** 清空本例写入文档根节点的类名、数据集与内联变量，避免影响后续用例。 */
function resetRoot(): void {
  const root = document.documentElement;
  root.classList.remove('dark');
  delete root.dataset.theme;
  root.removeAttribute('style');
}

describe('updateCSSVariables 主题变量写入', /** 偏好主题到真实 DOM 的映射契约。 */ () => {
  afterEach(
    /** 每个用例结束后恢复文档根节点，避免变量与类名泄漏到其他用例。 */ () => {
      resetRoot();
    },
  );

  it('暗色模式写入 dark 类，内置主题写入 data-theme', /** 主题值与内置主题名必须落到文档根节点，样式表才能按选择器生效。 */ () => {
    const root = document.documentElement;
    root.dataset.theme = 'light';

    updateCSSVariables(
      preferencesWithTheme({
        builtinType: 'violet',
        colorPrimary: 'hsl(200 100% 50%)',
        fontSize: 16,
        mode: 'dark',
        radius: 0.5,
      }),
    );

    expect(root.classList.contains('dark')).toBe(true);
    expect(root.dataset.theme).toBe('violet');
    expect(rootStyleValue('--radius')).toBe('0.5rem');
    expect(rootStyleValue('--font-size-base')).toBe('16px');
    expect(rootStyleValue('--menu-font-size')).toBe('calc(16px * 0.875)');
  });

  it('亮色模式移除 dark 类且不覆盖同值主题名', /** 非暗色主题必须清除暗色类；主题名未变化时保持原值。 */ () => {
    const root = document.documentElement;
    root.classList.add('dark');
    root.dataset.theme = 'violet';

    updateCSSVariables(
      preferencesWithTheme({
        builtinType: 'violet',
        mode: 'light',
      }),
    );

    expect(root.classList.contains('dark')).toBe(false);
    expect(root.dataset.theme).toBe('violet');
  });

  it('仅声明警告色时仍写入主色变量', /** 四个自定义色只要命中一个就必须进入主色计算，未声明的颜色不写空值。 */ () => {
    updateCSSVariables(
      preferencesWithTheme({
        colorWarning: 'hsl(42 84% 61%)',
      }),
    );

    expect(rootStyleValue('--warning')).not.toBe('');
    // 色阶变量由共享工具写入 :root 样式表，不能只看根节点内联样式。
    expect(injectedStyleText()).toContain('--warning-500:');
    expect(injectedStyleText()).toContain('--yellow-500:');
    // 未声明的颜色没有参与计算，不能被写成空字符串而覆盖默认变量。
    expect(rootStyleValue('--success')).toBe('');
    expect(rootStyleValue('--destructive')).toBe('');
  });

  it('仅声明危险色时同样进入主色计算', /** 逐个覆盖自定义色键，确保任意一个键都能触发主色写入而不是只认第一个。 */ () => {
    updateCSSVariables(
      preferencesWithTheme({
        colorDestructive: 'hsl(0 84% 60%)',
      }),
    );

    expect(rootStyleValue('--destructive')).not.toBe('');
    expect(injectedStyleText()).toContain('--red-500:');
    expect(rootStyleValue('--primary')).toBe('');
  });

  it('内置主题与自定义色都没有时不改动主色变量', /** 条件不成立时必须整段跳过主色写入，保留样式表中的既有变量。 */ () => {
    updateCSSVariables(
      preferencesWithTheme({
        mode: 'light',
        radius: 0,
      }),
    );

    expect(rootStyleValue('--primary')).toBe('');
    expect(rootStyleValue('--warning')).toBe('');
    expect(rootStyleValue('--radius')).toBe('0rem');
  });

  it('文档根节点缺失时直接返回且不抛错', /** 非浏览器渲染环境没有 documentElement，主题写入必须安全退出而不是抛异常。 */ () => {
    const root = document.documentElement;
    const spy = vi
      .spyOn(document, 'documentElement', 'get')
      .mockReturnValue(undefined as unknown as HTMLElement);
    try {
      expect(isDarkTheme('dark')).toBe(true);

      expect(
        /** 在缺失文档根节点的环境下执行主题写入。 */ () =>
          updateCSSVariables(
            preferencesWithTheme({
              builtinType: 'default',
              colorPrimary: 'hsl(0 0% 0%)',
              fontSize: 14,
              mode: 'dark',
              radius: 1,
            }),
          ),
      ).not.toThrow();
    } finally {
      spy.mockRestore();
    }

    // 恢复文档根节点后重新写入，证明前面的调用确实没有改动任何变量。
    expect(root.classList.contains('dark')).toBe(false);
    expect(rootStyleValue('--font-size-base')).toBe('');
  });

  it('auto 模式按系统配色偏好判定暗色', /** auto 必须读取 matchMedia 的真实结果，而不是把 auto 当成暗色或亮色。 */ () => {
    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
    } as MediaQueryList);

    try {
      expect(isDarkTheme('auto')).toBe(true);
      expect(window.matchMedia).toHaveBeenCalledWith(
        '(prefers-color-scheme: dark)',
      );

      spy.mockReturnValue({ matches: false } as MediaQueryList);
      expect(isDarkTheme('auto')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
