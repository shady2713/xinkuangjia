/**
 * 设计令牌适配（use-design-tokens）的真实行为回归。
 *
 * 该模块把设计系统的 CSS 变量转换成 Ant Design 与 Naive UI 的主题令牌：变量映射写错
 * 会让某个组件族用错颜色（例如成功色显示成警告色）；颜色换算写错会让令牌不是合法
 * 的 rgb 值而直接被框架拒绝；圆角漏掉 1rem = 16px 换算会让弹窗与按钮圆角异常；主题
 * 切换后不重新读取变量会让界面停留在旧配色。用例在真实文档根节点上写入 CSS 变量并
 * 驱动真实 watcher，断言可观察的令牌取值与主题切换后的重新解析结果；仅在主题切换用例
 * 中替身计算样式读取边界（happy-dom 返回调用时的快照，浏览器返回实时计算值），
 * CSS 变量写入、令牌换算与 watcher 调度保持真实实现。
 */
import { effectScope } from 'vue';

import { preferences, updatePreferences } from '@vben/preferences';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useAntdDesignTokens,
  useElementPlusDesignTokens,
  useNaiveDesignTokens,
} from '../use-design-tokens';

/** 主题切换断言使用的等待轮次，让 watcher 的微任务队列执行完毕。 */
const THEME_FLUSH_TICKS = 2;

/** 用例开始前文档根节点的内联样式，结束后整体还原，避免主题变量写入影响其他用例。 */
const originalRootStyle = document.documentElement.getAttribute('style');

/** 用例开始前的真实主题对象，结束后通过真实更新入口还原。 */
const originalTheme = { ...preferences.theme };

/**
 * 无舍入歧义的色值对照表：键是写入文档根节点的 HSL 取值，值是期望的 rgb 结果。
 * 这些色相、饱和度与亮度换算结果都是整数，避免依赖第三方舍入细节。
 */
const RGB_BY_HSL = {
  'hsl(0 0% 0%)': 'rgb(0, 0, 0)',
  'hsl(0 0% 50%)': 'rgb(128, 128, 128)',
  'hsl(0 0% 100%)': 'rgb(255, 255, 255)',
  'hsl(0 100% 50%)': 'rgb(255, 0, 0)',
  'hsl(60 100% 50%)': 'rgb(255, 255, 0)',
  'hsl(120 100% 50%)': 'rgb(0, 255, 0)',
  'hsl(180 100% 50%)': 'rgb(0, 255, 255)',
  'hsl(240 100% 50%)': 'rgb(0, 0, 255)',
  'hsl(300 100% 50%)': 'rgb(255, 0, 255)',
} as const;

/** 本用例写入文档根节点的 CSS 变量名，结束后需要逐个清理。 */
const appliedVariables = new Set<string>();

/** 本用例创建的作用域，结束后停止以避免 watcher 泄漏到其他用例。 */
const scopes: ReturnType<typeof effectScope>[] = [];

/**
 * 在真实文档根节点写入 CSS 变量。
 * @param variables 变量名到取值的映射，取值为无单位的 HSL 分量或原始长度。
 */
function applyCssVariables(variables: Record<string, string>) {
  for (const [name, value] of Object.entries(variables)) {
    document.documentElement.style.setProperty(name, value);
    appliedVariables.add(name);
  }
}

/** 创建设计令牌的 composable 签名。 */
type TokensFactory<T> = () => T;

/**
 * 在独立作用域中创建设计令牌，结束后由 afterEach 统一停止。
 * @param create 创建令牌的 composable。
 * @returns 该 composable 返回的令牌对象。
 */
function createTokensInScope<T>(create: TokensFactory<T>): T {
  const scope = effectScope();
  scopes.push(scope);
  const tokens = scope.run(create);
  if (tokens === undefined) {
    throw new Error('作用域未返回设计令牌');
  }
  return tokens;
}

/**
 * 用实时读取文档根节点内联变量的替身替换计算样式读取。
 *
 * happy-dom 的 getComputedStyle 返回调用时的快照，无法观察到创建之后写入的变量；
 * 浏览器返回实时计算值，因此主题切换用例需要一个实时视图才能验证"重新读取变量"。
 */
function stubLiveComputedStyle() {
  const declaration = {
    /**
     * 实时读取文档根节点的内联 CSS 变量。
     * @param name CSS 变量名。
     * @returns 当前内联取值；未设置时为空串。
     */
    getPropertyValue: (name: string) =>
      document.documentElement.style.getPropertyValue(name),
  };
  vi.stubGlobal(
    'getComputedStyle',
    /** 返回实时计算样式替身，忽略传入元素。 */ () => declaration,
  );
}

/** 只写 CSS 变量、不返回令牌的 composable 签名。 */
type TokensWriter = () => void;

/**
 * 在独立作用域中执行只写 CSS 变量、不返回令牌的 composable，结束后由 afterEach 统一停止。
 * @param create 执行 CSS 变量写入的 composable。
 */
function runTokensInScope(create: TokensWriter) {
  const scope = effectScope();
  scopes.push(scope);
  scope.run(create);
}

/**
 * 通过真实偏好入口切换主题，并等待 watcher 重新解析完成。
 * @param theme 目标主题。
 * @param colorPrimary 主题主色，切换后由偏好实现重写文档根节点的主色变量。
 */
async function switchTheme(theme: 'dark' | 'light', colorPrimary: string) {
  // 生产入口会替换整个 theme 对象并重写主色变量，watcher 依赖引用变化。
  updatePreferences({ theme: { colorPrimary, mode: theme } });
  for (let index = 0; index < THEME_FLUSH_TICKS; index++) {
    await Promise.resolve();
  }
}

afterEach(
  /** 恢复主题与文档状态、停止作用域，避免写入的变量与 watcher 影响其他用例。 */ () => {
    for (const scope of scopes) {
      scope.stop();
    }
    scopes.length = 0;
    vi.unstubAllGlobals();
    // 通过真实入口还原主题，让偏好状态与首次加载时一致。
    updatePreferences({ theme: { ...originalTheme } });
    document.documentElement.classList.remove('dark');
    if (originalRootStyle === null) {
      document.documentElement.removeAttribute('style');
    } else {
      document.documentElement.setAttribute('style', originalRootStyle);
    }
    // Element Plus 令牌通过内联样式表写入，结束后移除，避免污染其他用例。
    document.querySelector('#__vben_design_styles__')?.remove();
    appliedVariables.clear();
  },
);

describe('antd 设计令牌', /** 变量映射与圆角换算决定 antd 组件族的配色与形状。 */ () => {
  it('按 CSS 变量填充全部主题令牌', /** 映射写错会让组件族用错颜色，圆角漏换算会让形状异常。 */ () => {
    applyCssVariables({
      '--background': '0 0% 100%',
      '--background-deep': '0 0% 50%',
      '--border': '240 100% 50%',
      '--card': '0 0% 0%',
      '--destructive': '0 100% 50%',
      '--foreground': '0 0% 50%',
      '--overlay': '0 0% 0%',
      '--popover': '0 0% 100%',
      '--primary': '120 100% 50%',
      '--primary-foreground': '0 0% 100%',
      '--radius': '0.5rem',
      '--success': '60 100% 50%',
      '--warning': '300 100% 50%',
    });

    const { tokens } = createTokensInScope(useAntdDesignTokens);

    expect(tokens.colorPrimary).toBe('hsl(120 100% 50%)');
    // 信息色沿用主色，避免提示与主操作视觉冲突。
    expect(tokens.colorInfo).toBe('hsl(120 100% 50%)');
    expect(tokens.colorError).toBe('hsl(0 100% 50%)');
    expect(tokens.colorWarning).toBe('hsl(300 100% 50%)');
    expect(tokens.colorSuccess).toBe('hsl(60 100% 50%)');
    expect(tokens.colorTextBase).toBe('hsl(0 0% 50%)');
    // 主边框与次级边框同源，深浅色主题下保持一致。
    expect(tokens.colorBorder).toBe('hsl(240 100% 50%)');
    expect(tokens.colorBorderSecondary).toBe('hsl(240 100% 50%)');
    expect(tokens.colorBgElevated).toBe('hsl(0 0% 100%)');
    expect(tokens.colorBgContainer).toBe('hsl(0 0% 0%)');
    expect(tokens.colorBgBase).toBe('hsl(0 0% 100%)');
    expect(tokens.colorBgLayout).toBe('hsl(0 0% 50%)');
    expect(tokens.colorBgMask).toBe('hsl(0 0% 0%)');
    // 0.5rem 按 1rem = 16px 换算为 8px，供 antd 的圆角令牌直接使用。
    expect(tokens.borderRadius).toBe(8);
    // 弹层层级需要高于最大化表格，避免下拉被遮挡。
    expect(tokens.zIndexPopupBase).toBe(2000);
  });

  it('主题切换后按新的 CSS 变量重新解析', /** 不重新解析会让界面停留在旧配色，切换主题看起来无效。 */ async () => {
    stubLiveComputedStyle();
    applyCssVariables({
      '--background': '0 0% 100%',
      '--border': '0 0% 0%',
      '--primary': '120 100% 50%',
      '--radius': '0.5rem',
    });
    const { tokens } = createTokensInScope(useAntdDesignTokens);
    expect(tokens.colorPrimary).toBe('hsl(120 100% 50%)');
    expect(tokens.colorBorder).toBe('hsl(0 0% 0%)');

    // 主题入口把主色重写为纯红（HSL 0 100% 50%），同时手工改写边框变量，
    // 用于区分"主题重写"与"重新读取文档变量"两条路径。
    applyCssVariables({ '--border': '240 100% 50%' });
    await switchTheme('dark', '#ff0000');

    expect(tokens.colorPrimary).toBe('hsl(0 100% 50%)');
    expect(tokens.colorBorder).toBe('hsl(240 100% 50%)');
    // 未被任何一方改写的变量保持原值，说明重新解析不会污染其他令牌。
    expect(tokens.colorBgBase).toBe('hsl(0 0% 100%)');
    expect(tokens.borderRadius).toBe(8);
  });
});

describe('naive 设计令牌', /** 变量映射与 rgb 换算决定 naive 组件族能否直接消费令牌。 */ () => {
  it('按 CSS 变量填充全部公共令牌并换算为 rgb', /** 映射写错会让组件族用错颜色，未换算会让框架拒绝非法色值。 */ () => {
    applyCssVariables({
      '--background': '0 0% 100%',
      '--background-deep': '0 0% 50%',
      '--border': '240 100% 50%',
      '--card': '0 0% 0%',
      '--destructive': '0 100% 50%',
      '--destructive-600': '60 100% 50%',
      '--destructive-700': '120 100% 50%',
      '--destructive-800': '180 100% 50%',
      '--foreground': '0 0% 50%',
      '--popover': '0 0% 100%',
      '--primary': '120 100% 50%',
      '--primary-600': '240 100% 50%',
      '--primary-700': '300 100% 50%',
      '--primary-800': '0 0% 0%',
      '--primary-foreground': '0 0% 100%',
      '--radius': '0.5rem',
      '--success': '60 100% 50%',
      '--success-600': '180 100% 50%',
      '--success-700': '0 0% 0%',
      '--success-800': '0 0% 50%',
      '--warning': '300 100% 50%',
      '--warning-600': '0 100% 50%',
      '--warning-700': '120 100% 50%',
      '--warning-800': '240 100% 50%',
    });

    const { commonTokens } = createTokensInScope(useNaiveDesignTokens);

    expect(commonTokens).toEqual({
      baseColor: RGB_BY_HSL['hsl(0 0% 100%)'],
      bodyColor: RGB_BY_HSL['hsl(0 0% 100%)'],
      borderColor: RGB_BY_HSL['hsl(240 100% 50%)'],
      borderRadius: '0.5rem',
      cardColor: RGB_BY_HSL['hsl(0 0% 0%)'],
      dividerColor: RGB_BY_HSL['hsl(240 100% 50%)'],
      errorColor: RGB_BY_HSL['hsl(0 100% 50%)'],
      errorColorHover: RGB_BY_HSL['hsl(60 100% 50%)'],
      errorColorPressed: RGB_BY_HSL['hsl(120 100% 50%)'],
      errorColorSuppl: RGB_BY_HSL['hsl(180 100% 50%)'],
      invertedColor: RGB_BY_HSL['hsl(0 0% 50%)'],
      modalColor: RGB_BY_HSL['hsl(0 0% 100%)'],
      popoverColor: RGB_BY_HSL['hsl(0 0% 100%)'],
      primaryColor: RGB_BY_HSL['hsl(120 100% 50%)'],
      primaryColorHover: RGB_BY_HSL['hsl(240 100% 50%)'],
      primaryColorPressed: RGB_BY_HSL['hsl(300 100% 50%)'],
      primaryColorSuppl: RGB_BY_HSL['hsl(0 0% 0%)'],
      successColor: RGB_BY_HSL['hsl(60 100% 50%)'],
      successColorHover: RGB_BY_HSL['hsl(180 100% 50%)'],
      successColorPressed: RGB_BY_HSL['hsl(0 0% 0%)'],
      successColorSuppl: RGB_BY_HSL['hsl(0 0% 50%)'],
      tableColor: RGB_BY_HSL['hsl(0 0% 0%)'],
      textColorBase: RGB_BY_HSL['hsl(0 0% 50%)'],
      warningColor: RGB_BY_HSL['hsl(300 100% 50%)'],
      warningColorHover: RGB_BY_HSL['hsl(0 100% 50%)'],
      warningColorPressed: RGB_BY_HSL['hsl(120 100% 50%)'],
      warningColorSuppl: RGB_BY_HSL['hsl(240 100% 50%)'],
    });
  });

  it('主题切换后按新的 CSS 变量重新换算', /** 不重新换算会让深色主题下的组件仍是浅色令牌。 */ async () => {
    stubLiveComputedStyle();
    applyCssVariables({
      '--card': '0 0% 0%',
      '--primary': '120 100% 50%',
    });
    const { commonTokens } = createTokensInScope(useNaiveDesignTokens);
    expect(commonTokens.primaryColor).toBe(RGB_BY_HSL['hsl(120 100% 50%)']);
    expect(commonTokens.cardColor).toBe(RGB_BY_HSL['hsl(0 0% 0%)']);

    // 主题入口把主色重写为纯红，同时手工改写卡片变量，
    // 用于区分"主题重写"与"重新读取文档变量"两条路径。
    applyCssVariables({ '--card': '60 100% 50%' });
    await switchTheme('dark', '#ff0000');

    expect(commonTokens.primaryColor).toBe(RGB_BY_HSL['hsl(0 100% 50%)']);
    expect(commonTokens.tableColor).toBe(RGB_BY_HSL['hsl(60 100% 50%)']);
    expect(commonTokens.cardColor).toBe(RGB_BY_HSL['hsl(60 100% 50%)']);
  });
});

describe('element plus 设计令牌', /** 深浅分支决定 Element Plus 组件族的边框、遮罩与色阶取值。 */ () => {
  it('浅色主题按浅色分支写入变量', /** 深浅分支写反会让浅色主题使用深色遮罩与深色色阶。 */ () => {
    applyCssVariables({
      '--background': '0 0% 100%',
      '--primary-400': '60 100% 50%',
      '--primary-600': '180 100% 50%',
    });
    updatePreferences({ theme: { mode: 'light' } });

    runTokensInScope(useElementPlusDesignTokens);

    const style = document.querySelector('#__vben_design_styles__');
    const cssText = style?.textContent ?? '';
    // 浅色主题的深色阶取自 --primary-600，浅色阶取自 --primary-400。
    expect(cssText).toContain('--el-color-primary-dark-2: rgb(0, 255, 255)');
    expect(cssText).toContain('--el-color-primary-light-3: rgb(255, 255, 0)');
    expect(cssText).toContain('--el-mask-color: rgba(255,255,255,.9)');
    expect(cssText).toContain('--el-bg-color: rgb(255, 255, 255)');
  });

  it('深色主题按深色分支写入变量', /** 深色分支写反会让深色主题使用白色遮罩与浅色色阶。 */ () => {
    applyCssVariables({
      '--background': '0 0% 0%',
      '--primary-400': '60 100% 50%',
      '--primary-600': '180 100% 50%',
    });
    updatePreferences({ theme: { mode: 'dark' } });

    runTokensInScope(useElementPlusDesignTokens);

    const style = document.querySelector('#__vben_design_styles__');
    const cssText = style?.textContent ?? '';
    // 深色主题的深色阶取自 --primary-400，浅色阶取自 --primary-600。
    expect(cssText).toContain('--el-color-primary-dark-2: rgb(255, 255, 0)');
    expect(cssText).toContain('--el-color-primary-light-3: rgb(0, 255, 255)');
    expect(cssText).toContain('--el-mask-color: rgba(0,0,0,.8)');
    expect(cssText).toContain('--el-bg-color: rgb(0, 0, 0)');
  });

  it('主题切换后按新的深浅分支重新写入', /** 切换主题不重写会让界面停留在旧配色的遮罩与色阶。 */ async () => {
    applyCssVariables({
      '--primary-400': '60 100% 50%',
      '--primary-600': '180 100% 50%',
    });
    updatePreferences({ theme: { mode: 'dark' } });
    runTokensInScope(useElementPlusDesignTokens);

    await switchTheme('light', '#00ff00');

    const cssText =
      document.querySelector('#__vben_design_styles__')?.textContent ?? '';
    expect(cssText).toContain('--el-mask-color: rgba(255,255,255,.9)');
  });
});
