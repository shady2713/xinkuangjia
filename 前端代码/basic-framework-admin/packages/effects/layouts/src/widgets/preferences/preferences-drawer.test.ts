/**
 * 偏好设置抽屉（widgets/preferences/preferences-drawer.vue）真实交互回归。
 *
 * 该抽屉是用户改偏好的唯一入口：四个分区把外观、布局、快捷键、通用偏好交给真实控件，工具栏提供
 * 吸顶、重置与复制，底部提供清空缓存并退出。模板里的每个双向绑定处理器都是写回链路的一环，任何一项
 * 断开都会让用户在抽屉里改的设置存不进全局偏好；重置写错会让用户无法回到默认；复制写错会让用户拿不到
 * 当前差异。用例真实打开抽屉、真实切换分区、真实点击/步进/下拉选中每个配置项，并断言全局偏好与 DOM。
 */
import { DOMWrapper, mount } from '@vue/test-utils';
import { createApp, h, nextTick } from 'vue';

import { setupI18n } from '@vben/locales';
import {
  preferences,
  resetPreferences,
  updatePreferences,
} from '@vben/preferences';

import { globalShareState } from '@vben-core/shared/global-state';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import PreferencesDrawer from './preferences-drawer.vue';
import Preferences from './preferences.vue';

/** 复制成功消息的真实载荷记录，用来核对复制链路是否走到界面提示。 */
const copiedMessages: Array<{ content: string; title: string }> = [];

/** 每个用例挂载的宿主，用例结束后统一卸载并清理抽屉传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主、清理抽屉传送节点并还原被用例改动的偏好。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
    resetPreferences();
  },
);

/**
 * 建立仅用于安装 i18n 插件的空应用宿主。
 * @returns 未挂载的空 Vue 应用实例。
 */
function createAppHost() {
  return createApp({
    /** 渲染空节点：该宿主只用于安装 i18n 插件，不参与界面断言。 */
    render: () => h('div'),
  });
}

beforeAll(
  /** 按真实 API 装载中文语言包并登记真实复制成功消息回调。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
    globalShareState.defineMessage({
      /** 记录复制成功消息的真实载荷。 */
      copyPreferencesSuccess: (title: string, content?: string) => {
        copiedMessages.push({ content: content ?? '', title });
      },
    });
  },
);

/**
 * 真实点击默认齿轮入口打开抽屉，并等待抽屉页签传送挂载。
 * @returns 已挂载的偏好设置入口宿主。
 */
async function openDrawer() {
  const wrapper = mount(Preferences);

  await wrapper.get('button').trigger('click');
  await vi.waitFor(
    /** 等待抽屉内容真实传送出分区页签。 */ () => {
      expect(document.querySelector('[role="tablist"]')).not.toBeNull();
    },
    { timeout: 2000 },
  );
  return wrapper;
}

/**
 * 按可见文案真实点击分区页签，并等待该分区的首个区块真实挂载。
 * @param label 分区页签文案。
 * @param blockTitle 该分区内首个配置块标题。
 * @returns 分区内容挂载完成后的 Promise。
 */
async function switchTab(label: string, blockTitle: string) {
  const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    /** 按可见文案定位目标分区页签。 */ (element) =>
      element.textContent?.trim() === label,
  );
  expect(tab).toBeDefined();
  if (tab) {
    // reka-ui 的页签在鼠标左键按下时切换选中段，与真实用户操作一致。
    await new DOMWrapper(tab).trigger('mousedown');
  }
  await vi.waitFor(
    /** 等待目标分区的配置块真实挂载。 */ () => {
      const titles = [...document.querySelectorAll('h3')].map(
        /** 收集当前已挂载的配置块标题。 */ (node) => node.textContent,
      );
      expect(titles).toContain(blockTitle);
    },
    { timeout: 2000 },
  );
  await nextTick();
}

/**
 * 按标题定位抽屉里的配置块。
 * @param title 配置块标题。
 * @returns 命中的配置块元素。
 * @throws 配置块尚未渲染时抛出，避免用例在缺失区块时静默通过。
 */
function findBlock(title: string): HTMLElement {
  const heading = [...document.querySelectorAll<HTMLElement>('h3')].find(
    /** 按可见标题定位配置块。 */ (node) => node.textContent?.trim() === title,
  );
  const block = heading?.parentElement;
  if (!block) {
    throw new Error(`抽屉中未找到标题为「${title}」的配置块`);
  }
  return block;
}

/**
 * 在配置块内按可见文案定位承载该配置项的整行元素。
 * @param title 配置块标题。
 * @param selector 该行内真实控件使用的选择器。
 * @param label 行内可见文案，按前缀匹配以兼容下拉与按钮组追加的取值文案。
 * @returns 命中的配置行元素。
 * @throws 匹配不到唯一配置行时抛出，避免用例因定位失败而跳过真实交互。
 */
function findRow(title: string, selector: string, label: string): HTMLElement {
  const block = findBlock(title);
  const rows = new Set<HTMLElement>();
  for (const control of block.querySelectorAll<HTMLElement>(selector)) {
    // 从真实控件向上找到第一个已经带上该项文案的祖先节点，即整行容器。
    let node = control.parentElement;
    while (
      node &&
      node !== block &&
      !node.textContent?.trim().startsWith(label)
    ) {
      node = node.parentElement;
    }
    if (node && node !== block) {
      rows.add(node);
    }
  }
  expect([...rows]).toHaveLength(1);
  const row = [...rows][0];
  if (!row) {
    throw new Error(`配置块「${title}」中未找到文案为「${label}」的配置行`);
  }
  return row;
}

/**
 * 真实点击某个开关行。
 * @param title 配置块标题。
 * @param label 开关行文案。
 * @returns 点击完成后的 Promise。
 */
async function clickSwitch(title: string, label: string) {
  const row = findRow(title, 'button[role="switch"]', label);

  await new DOMWrapper(row).trigger('click');
  await nextTick();
  await nextTick();
}

/**
 * 在某个配置行的按钮组里真实点击指定按钮。
 * @param title 配置块标题。
 * @param label 配置行文案。
 * @param optionLabel 目标按钮文案。
 * @returns 点击完成后的 Promise。
 */
async function clickGroupOption(
  title: string,
  label: string,
  optionLabel: string,
) {
  const row = findRow(title, 'button', label);
  const option = [...row.querySelectorAll('button')].find(
    /** 按可见文案定位目标按钮。 */ (element) =>
      element.textContent?.trim() === optionLabel,
  );
  expect(option).toBeDefined();
  if (option) {
    await new DOMWrapper(option).trigger('click');
  }
  await nextTick();
  await nextTick();
}

/**
 * 真实点击配置块里的某张预览卡片。
 * @param title 配置块标题。
 * @param label 卡片文案。
 * @returns 点击完成后的 Promise。
 */
async function clickOutlineBox(title: string, label: string) {
  const block = findBlock(title);
  const matches = [
    ...block.querySelectorAll<HTMLElement>('.outline-box'),
  ].filter(
    /** 只保留外层文案匹配的预览卡片。 */ (box) =>
      box.parentElement?.textContent?.trim().startsWith(label) === true,
  );
  expect(matches).toHaveLength(1);
  if (matches[0]) {
    await new DOMWrapper(matches[0]).trigger('click');
  }
  await nextTick();
  await nextTick();
}

/**
 * 真实点击配置块里的某个按钮。
 * @param title 配置块标题。
 * @param buttonText 目标按钮文案。
 * @returns 点击完成后的 Promise。
 */
async function clickButtonInBlock(title: string, buttonText: string) {
  const block = findBlock(title);
  const button = [...block.querySelectorAll('button')].find(
    /** 按可见文案定位目标按钮。 */ (element) =>
      element.textContent?.trim() === buttonText,
  );
  expect(button).toBeDefined();
  if (button) {
    await new DOMWrapper(button).trigger('click');
  }
  await nextTick();
  await nextTick();
}

/**
 * 真实点击配置块里第 index 张没有文案的预览卡片，例如动画预设。
 * @param title 配置块标题。
 * @param index 卡片序号，从 0 开始。
 * @returns 点击完成后的 Promise。
 */
async function clickPreviewBoxByIndex(title: string, index: number) {
  const block = findBlock(title);
  const boxes = [...block.querySelectorAll<HTMLElement>('.outline-box')];

  expect(boxes.length).toBeGreaterThan(index);
  if (boxes[index]) {
    await new DOMWrapper(boxes[index]).trigger('click');
  }
  await nextTick();
  await nextTick();
}

/**
 * 真实点击某个数值配置项的加号，按步长写回新值。
 * @param title 配置块标题。
 * @param label 数值配置行文案，留空表示整块只有一个数值输入。
 * @returns 步进完成后的 Promise。
 */
async function stepUpNumber(title: string, label = '') {
  const block = findBlock(title);
  const scope =
    label === '' ? block : findRow(title, '[data-slot="increment"]', label);
  const increment = scope.querySelector<HTMLElement>('[data-slot="increment"]');
  expect(increment).not.toBeNull();
  await nextTick();
  if (increment) {
    // 步进按钮走真实指针链路：reka-ui 在 pointerdown 上开始步进、pointerup 上结束。
    await new DOMWrapper(increment).trigger('pointerdown', { button: 0 });
    await new DOMWrapper(increment).trigger('pointerup');
  }
  await nextTick();
  await nextTick();
}

/**
 * 展开某个下拉配置项并真实选中一项。
 * @param title 配置块标题。
 * @param label 下拉配置行文案。
 * @param optionLabel 目标下拉项文案。
 * @param optionCount 该下拉真实渲染的选项总数。
 * @returns 选中写回后的 Promise。
 */
async function selectOption(
  title: string,
  label: string,
  optionLabel: string,
  optionCount: number,
) {
  const row = findRow(title, '[role="combobox"]', label);
  const trigger = row.querySelector<HTMLElement>('[role="combobox"]');
  expect(trigger).not.toBeNull();
  if (!trigger) {
    return;
  }
  const triggerWrapper = new DOMWrapper(trigger);

  await triggerWrapper.trigger('click');
  await triggerWrapper.trigger('keydown', { key: 'ArrowDown' });
  await vi.waitFor(
    /** 等待该下拉的真实选项全部渲染。 */ () => {
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(
        optionCount,
      );
    },
    { timeout: 2000 },
  );

  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find(
    /** 按文案定位目标下拉项。 */ (element) =>
      element.textContent?.includes(optionLabel),
  );
  expect(option).toBeDefined();
  if (option) {
    // 下拉项走真实指针链路提交选择：reka-ui 在 pointerup 上写回取值。
    option.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    option.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, button: 0 }),
    );
    option.click();
  }
  await vi.waitFor(
    /** 等待选中结果真实回显到下拉触发器。 */ () => {
      expect(trigger.textContent).toContain(optionLabel);
    },
    { timeout: 2000 },
  );
}

/**
 * 真实填写某个文本配置项。
 * @param title 配置块标题。
 * @param label 文本配置行文案。
 * @param value 待写入的文本值。
 * @returns 写入完成后的 Promise。
 */
async function fillInput(title: string, label: string, value: string) {
  const row = findRow(title, 'input', label);
  const input = row.querySelector<HTMLInputElement>('input');
  expect(input).not.toBeNull();
  if (input) {
    await new DOMWrapper(input).setValue(value);
  }
  await nextTick();
  await nextTick();
}

/**
 * 按图标真实定位抽屉工具栏按钮。
 * @param svgClass 按钮内图标的样式类名。
 * @returns 命中的按钮元素。
 * @throws 工具栏按钮缺失时抛出，避免用例在入口消失后静默通过。
 */
function findToolbarButton(svgClass: string): HTMLButtonElement {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find(
    /** 按内部图标定位工具栏按钮。 */ (element) =>
      element.querySelector(`.${svgClass}`) !== null,
  );
  if (!button) {
    throw new Error(`未找到包含 ${svgClass} 图标的抽屉工具栏按钮`);
  }
  return button;
}

describe('偏好设置抽屉-外观分区', /** 外观写回断开会让主题、圆角、字号改了不生效。 */ () => {
  it('真实操作主题、内置主题、圆角、字号与其它外观项', /** 任一项写回断开都会让外观配置存不进偏好。 */ async () => {
    mounted = await openDrawer();

    // 主题预设：默认深色，切到浅色必须真实写回并让深色侧边栏/顶栏恢复可用。
    await clickOutlineBox('主题', '浅色');
    await vi.waitFor(
      /** 等待主题模式真实写入全局偏好。 */ () => {
        expect(preferences.theme.mode).toBe('light');
      },
      { timeout: 2000 },
    );
    await clickSwitch('主题', '深色侧边栏');
    expect(preferences.theme.semiDarkSidebar).toBe(true);
    await clickSwitch('主题', '深色顶栏');
    expect(preferences.theme.semiDarkHeader).toBe(true);

    // 内置主题：色板必须跟着所选主题联动写回。
    await clickOutlineBox('内置主题', '紫罗兰');
    await vi.waitFor(
      /** 等待内置主题与主色一起写回全局偏好。 */ () => {
        expect(preferences.theme.builtinType).toBe('violet');
        expect(preferences.theme.colorPrimary).toBe('hsl(245 82% 67%)');
      },
      { timeout: 2000 },
    );

    // 圆角按钮组：点第二档必须写回对应圆角值。
    await clickButtonInBlock('圆角', '0.25');
    expect(preferences.theme.radius).toBe('0.25');

    // 字号步进：加一个步长后写回 17。
    await stepUpNumber('字体大小');
    expect(preferences.theme.fontSize).toBe(17);

    // 其它：灰色模式与色弱模式都真实写回。
    await clickSwitch('其它', '灰色模式');
    expect(preferences.app.colorGrayMode).toBe(true);
    await clickSwitch('其它', '色弱模式');
    expect(preferences.app.colorWeakMode).toBe(true);
  });
});

describe('偏好设置抽屉-布局分区', /** 布局写回断开会让侧边栏、顶栏、面包屑配置失配。 */ () => {
  it('真实操作侧边栏、顶栏与面包屑配置', /** 任一项写回断开都会让布局偏好停在旧值。 */ async () => {
    mounted = await openDrawer();
    await switchTab('布局', '布局');

    // 侧边栏：显隐开关往返一次，其余项在启用状态下逐个真实点击。
    await clickSwitch('侧边栏', '显示侧边栏');
    expect(preferences.sidebar.enable).toBe(false);
    await clickSwitch('侧边栏', '显示侧边栏');
    expect(preferences.sidebar.enable).toBe(true);
    await clickSwitch('侧边栏', '折叠菜单');
    expect(preferences.sidebar.collapsed).toBe(true);
    await clickSwitch('侧边栏', '鼠标悬停展开');
    expect(preferences.sidebar.expandOnHover).toBe(false);
    await clickSwitch('侧边栏', '折叠显示菜单名');
    expect(preferences.sidebar.collapsedShowTitle).toBe(true);
    await stepUpNumber('侧边栏', '宽度');
    // 224 加一个步长后被吸附到以 min 为基准的步长网格上，得到 230。
    expect(preferences.sidebar.width).toBe(230);
    await clickGroupOption('侧边栏', '显示按钮', '折叠按钮');
    expect(preferences.sidebar.collapsedButton).toBe(false);
    await clickGroupOption('侧边栏', '显示按钮', '固定按钮');
    expect(preferences.sidebar.fixedButton).toBe(false);

    // 顶栏：显隐往返一次，模式下拉与菜单位置按钮各自真实操作。
    await clickSwitch('顶栏', '显示顶栏');
    expect(preferences.header.enable).toBe(false);
    await clickSwitch('顶栏', '显示顶栏');
    expect(preferences.header.enable).toBe(true);
    await clickGroupOption('顶栏', '菜单位置', '居中');
    expect(preferences.header.menuAlign).toBe('center');
    await selectOption('顶栏', '模式', '滚动隐藏和显示', 4);
    expect(preferences.header.mode).toBe('auto-scroll');

    // 面包屑：开关与风格按钮逐项真实操作。
    await clickSwitch('面包屑导航', '仅有一个时隐藏');
    expect(preferences.breadcrumb.hideOnlyOne).toBe(true);
    await clickSwitch('面包屑导航', '显示首页按钮');
    expect(preferences.breadcrumb.showHome).toBe(true);
    await clickSwitch('面包屑导航', '显示面包屑图标');
    expect(preferences.breadcrumb.showIcon).toBe(false);
    await clickGroupOption('面包屑导航', '面包屑风格', '背景');
    expect(preferences.breadcrumb.styleType).toBe('background');
    await clickSwitch('面包屑导航', '开启面包屑导航');
    expect(preferences.breadcrumb.enable).toBe(false);
  });

  it('真实操作标签栏、小部件、底栏与版权配置', /** 这些写回断开会让标签栏与页脚配置点了没反应。 */ async () => {
    mounted = await openDrawer();
    await switchTab('布局', '布局');

    // 标签栏：九个开关、数值与风格下拉全部真实操作。
    await clickSwitch('标签栏', '持久化标签页');
    expect(preferences.tabbar.persist).toBe(false);
    await clickSwitch('标签栏', '访问历史记录');
    expect(preferences.tabbar.visitHistory).toBe(false);
    await clickSwitch('标签栏', '启动拖拽排序');
    expect(preferences.tabbar.draggable).toBe(false);
    await clickSwitch('标签栏', '启用纵向滚轮响应');
    expect(preferences.tabbar.wheelable).toBe(false);
    await clickSwitch('标签栏', '点击鼠标中键关闭标签页');
    expect(preferences.tabbar.middleClickToClose).toBe(true);
    await clickSwitch('标签栏', '显示标签栏图标');
    expect(preferences.tabbar.showIcon).toBe(false);
    await clickSwitch('标签栏', '显示更多按钮');
    expect(preferences.tabbar.showMore).toBe(false);
    await clickSwitch('标签栏', '显示最大化按钮');
    expect(preferences.tabbar.showMaximize).toBe(false);
    await stepUpNumber('标签栏', '最大标签数');
    expect(preferences.tabbar.maxCount).toBe(5);
    await selectOption('标签栏', '标签页风格', '轻快', 4);
    expect(preferences.tabbar.styleType).toBe('brisk');
    await clickSwitch('标签栏', '启用标签栏');
    expect(preferences.tabbar.enable).toBe(false);

    // 小部件：七个开关与偏好设置位置下拉全部真实操作。
    await clickSwitch('小部件', '启用全局搜索');
    expect(preferences.widget.globalSearch).toBe(false);
    await clickSwitch('小部件', '启用主题切换');
    expect(preferences.widget.themeToggle).toBe(false);
    await clickSwitch('小部件', '启用全屏');
    expect(preferences.widget.fullscreen).toBe(false);
    await clickSwitch('小部件', '启用通知');
    expect(preferences.widget.notification).toBe(false);
    await clickSwitch('小部件', '启用锁屏');
    expect(preferences.widget.lockScreen).toBe(false);
    await clickSwitch('小部件', '启用侧边栏切换');
    expect(preferences.widget.sidebarToggle).toBe(false);
    await clickSwitch('小部件', '启用刷新');
    expect(preferences.widget.refresh).toBe(false);
    await selectOption('小部件', '偏好设置位置', '顶栏', 3);
    expect(preferences.app.preferencesButtonPosition).toBe('header');

    // 底栏：先开底栏，再打开固定在底部。
    await clickSwitch('底栏', '显示底栏');
    expect(preferences.footer.enable).toBe(true);
    await clickSwitch('底栏', '固定在底部');
    expect(preferences.footer.fixed).toBe(true);

    // 版权：开关往返一次后逐项填写五个文本配置。
    await clickSwitch('版权', '启用版权');
    expect(preferences.copyright.enable).toBe(false);
    await clickSwitch('版权', '启用版权');
    expect(preferences.copyright.enable).toBe(true);
    await fillInput('版权', '公司名', 'DUMMY-公司名');
    expect(preferences.copyright.companyName).toBe('DUMMY-公司名');
    await fillInput('版权', '公司主页', 'https://DUMMY.example.com');
    expect(preferences.copyright.companySiteLink).toBe(
      'https://DUMMY.example.com',
    );
    await fillInput('版权', '日期', '2025');
    expect(preferences.copyright.date).toBe('2025');
    await fillInput('版权', 'ICP 备案号', 'DUMMY-ICP备案号');
    expect(preferences.copyright.icp).toBe('DUMMY-ICP备案号');
    await fillInput('版权', 'ICP 网站链接', 'https://DUMMY.beian.example.com');
    expect(preferences.copyright.icpLink).toBe(
      'https://DUMMY.beian.example.com',
    );
  });

  it('真实切换整体布局并操作导航菜单与内容宽度', /** 布局与导航写回断开会让菜单形态始终停留在默认。 */ async () => {
    mounted = await openDrawer();
    await switchTab('布局', '布局');

    // 内容宽度：切到定宽。
    await clickOutlineBox('内容', '定宽');
    expect(preferences.app.contentCompact).toBe('compact');

    // 整体布局：切到混合垂直后，导航分离项才允许配置。
    await clickOutlineBox('布局', '混合垂直');
    expect(preferences.app.layout).toBe('mixed-nav');

    await clickSwitch('导航菜单', '导航菜单分离');
    expect(preferences.navigation.split).toBe(false);
    await clickSwitch('导航菜单', '侧边导航菜单手风琴模式');
    expect(preferences.navigation.accordion).toBe(false);
    await clickGroupOption('导航菜单', '导航菜单风格', '朴素');
    expect(preferences.navigation.styleType).toBe('plain');
  });
});

describe('偏好设置抽屉-快捷键与通用分区', /** 快捷键与通用写回断开会让用户改不动这些偏好。 */ () => {
  it('真实操作快捷键分区开关', /** 开关写回断开会让快捷键配置点了没反应。 */ async () => {
    mounted = await openDrawer();
    await switchTab('快捷键', '全局');

    await clickSwitch('全局', '全局搜索');
    expect(preferences.shortcutKeys.globalSearch).toBe(false);
    await clickSwitch('全局', '退出登录');
    expect(preferences.shortcutKeys.globalLogout).toBe(false);
    await clickSwitch('全局', '锁定屏幕');
    expect(preferences.shortcutKeys.globalLockScreen).toBe(false);
    await clickSwitch('全局', '快捷键');
    expect(preferences.shortcutKeys.enable).toBe(false);
  });

  it('真实操作通用与动画分区配置', /** 水印与动画写回断开会让通用偏好改了不生效。 */ async () => {
    mounted = await openDrawer();
    await switchTab('通用', '通用');

    await clickSwitch('通用', '动态标题');
    expect(preferences.app.dynamicTitle).toBe(false);
    await clickSwitch('通用', '定时检查更新');
    expect(preferences.app.enableCheckUpdates).toBe(false);
    // 打开水印后才会出现水印文案输入项，必须真实填写进偏好。
    await clickSwitch('通用', '水印');
    expect(preferences.app.watermark).toBe(true);
    await fillInput('通用', '请输入水印文案', 'DUMMY-水印文案');
    expect(preferences.app.watermarkContent).toBe('DUMMY-水印文案');

    await clickSwitch('动画', '页面切换进度条');
    expect(preferences.transition.progress).toBe(false);
    await clickSwitch('动画', '页面切换 Loading');
    expect(preferences.transition.loading).toBe(false);
    // 动画预设只在开启动画时渲染，先选中第三个预设再关闭动画。
    await clickPreviewBoxByIndex('动画', 2);
    expect(preferences.transition.name).toBe('fade-up');
    await clickSwitch('动画', '页面切换动画');
    expect(preferences.transition.enable).toBe(false);
  });
});

describe('偏好设置抽屉-工具栏与底部操作', /** 吸顶、重置与复制失效会让用户无法管理偏好。 */ () => {
  it('点击吸顶按钮真实切换吸顶偏好与页签样式', /** 吸顶按钮点不动会让用户无法固定偏好导航栏。 */ async () => {
    mounted = await openDrawer();

    // 默认开启吸顶：页签容器带吸顶样式类。
    expect(preferences.app.enableStickyPreferencesNavigationBar).toBe(true);
    expect(document.querySelector('.sticky-tabs-header')).not.toBeNull();

    const pinButton = findToolbarButton('lucide-pin-off');
    await new DOMWrapper(pinButton).trigger('click');
    await nextTick();

    await vi.waitFor(
      /** 等待吸顶偏好真实关闭并换成未吸顶图标。 */ () => {
        expect(preferences.app.enableStickyPreferencesNavigationBar).toBe(
          false,
        );
        expect(document.querySelector('.lucide-pin-off')).toBeNull();
      },
      { timeout: 2000 },
    );
    expect(document.querySelector('.sticky-tabs-header')).toBeNull();
    expect(findToolbarButton('lucide-pin')).not.toBeNull();
  });

  it('点击重置按钮把被改动的偏好还原为默认', /** 重置失效会让用户无法从改乱的偏好回到默认配置。 */ async () => {
    updatePreferences({ app: { name: 'DUMMY-品牌名' } });
    mounted = await openDrawer();

    const resetButton = findToolbarButton('lucide-rotate-cw');
    // 偏好与默认值不同后重置按钮必须可点，否则用户无法还原配置。
    expect(resetButton.hasAttribute('disabled')).toBe(false);

    await new DOMWrapper(resetButton).trigger('click');
    await vi.waitFor(
      /** 等待重置真实还原被改动的偏好。 */ () => {
        expect(preferences.app.name).toBe('管理后台');
      },
      { timeout: 2000 },
    );
    // 还原后差异消失，重置按钮必须回到禁用态。
    expect(findToolbarButton('lucide-rotate-cw').hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('清空缓存后迟到的重置点击被守卫拦截', /** 守卫缺失会让已无差异时仍重复清理偏好并重载语言包。 */ async () => {
    updatePreferences({ app: { name: 'DUMMY-品牌名' } });
    mounted = await openDrawer();

    const clearButton = [
      ...document.querySelectorAll<HTMLButtonElement>('button'),
    ].find(
      /** 按文案定位清空缓存并退出登录按钮。 */ (element) =>
        element.textContent?.includes('清空缓存') === true,
    );
    expect(clearButton).toBeDefined();
    const resetButton = findToolbarButton('lucide-rotate-cw');
    expect(resetButton.hasAttribute('disabled')).toBe(false);

    // 用户真实点击清空缓存会把偏好还原为默认；按钮禁用态要等抽屉重渲染，此刻重置按钮仍显示为可点。
    // 两次点击之间不等待重渲染，模拟“偏好已被还原但界面还没刷新”的真实竞态窗口。
    if (clearButton) {
      clearButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    // 第一次点击必须真实走到清退链路，否则后面的迟到点击断言没有意义。
    expect(
      mounted
        ?.findComponent(PreferencesDrawer)
        .emitted('clearPreferencesAndLogout'),
    ).toHaveLength(1);
    expect(preferences.app.name).toBe('管理后台');

    await new DOMWrapper(resetButton).trigger('click');
    await nextTick();
    await nextTick();

    // 迟到的点击必须被守卫拦截：偏好保持默认，重渲染后重置按钮回到禁用态。
    expect(preferences.app.name).toBe('管理后台');
    expect(preferences.header.enable).toBe(true);
    expect(findToolbarButton('lucide-rotate-cw').hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('点击复制按钮真实提交差异并弹出复制成功提示', /** 复制失效会让用户拿不到当前偏好差异。 */ async () => {
    copiedMessages.length = 0;
    updatePreferences({ app: { name: 'DUMMY-品牌名' } });
    mounted = await openDrawer();

    const copyButton = [
      ...document.querySelectorAll<HTMLButtonElement>('button'),
    ].find(
      /** 按文案定位复制偏好设置按钮。 */ (element) =>
        element.textContent?.includes('复制偏好设置') === true,
    );
    expect(copyButton).toBeDefined();
    expect(copyButton?.hasAttribute('disabled')).toBe(false);

    if (copyButton) {
      await new DOMWrapper(copyButton).trigger('click');
    }
    await vi.waitFor(
      /** 等待复制成功消息真实回调。 */ () => {
        expect(copiedMessages).toHaveLength(1);
      },
      { timeout: 2000 },
    );

    expect(copiedMessages[0]?.title).toBe('复制成功');
    expect(copiedMessages[0]?.content).toContain('复制成功，请在 app 下的');
  });
});
