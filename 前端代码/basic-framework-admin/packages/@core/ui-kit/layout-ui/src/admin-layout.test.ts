/**
 * 后台布局外壳（layout-ui 的 admin-layout.vue）真实行为回归。
 *
 * 该组件把布局属性与偏好翻译成各区域的真实样式：侧边与顶栏宽度、内容区上边距与下内边距、
 * tabbar 偏移、遮罩与层级、以及顶栏自动隐藏。算错任何一处都会造成可见故障：混合导航下内容被
 * 侧边栏压住、全屏内容布局仍留出顶栏空隙、移动端遮罩点不掉、顶栏自动隐藏后无法唤出、页脚
 * 固定时内容被页脚覆盖。用例真实挂载组件并下发布局属性，通过真实点击遮罩与切换按钮、真实
 * 鼠标移动与滚动驱动分支，断言的是交给子组件的真实属性、真实 DOM 样式与真实 CSS 变量。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { ELEMENT_ID_MAIN_CONTENT } from '@vben-core/shared/constants';

import { afterEach, describe, expect, it } from 'vitest';

import VbenLayout from './admin-layout.vue';
import {
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutSidebar,
  LayoutTabbar,
} from './components';

/** 用例挂载的布局包装器，用例结束后统一卸载，避免全局滚动监听残留。 */
let wrapper: ReturnType<typeof mount> | undefined;

/** 布局默认的侧边栏宽度。 */
const SIDEBAR_WIDTH = 180;

/** 布局默认的混合侧边栏宽度。 */
const SIDEBAR_MIXED_WIDTH = 80;

/** 布局默认的顶栏高度。 */
const HEADER_HEIGHT = 50;

/** 布局默认的标签栏高度。 */
const TABBAR_HEIGHT = 40;

/** 布局默认的侧边折叠宽度。 */
const SIDE_COLLAPSE_WIDTH = 60;

/**
 * 挂载后台布局并传入插槽。
 * @param props 布局属性。
 * @param slots 各区域的插槽内容。
 * @returns 已挂载的布局包装器。
 */
function mountLayout(
  props: Record<string, unknown> = {},
  slots: Record<string, unknown> = {},
) {
  wrapper = mount(VbenLayout, {
    props,
    slots: {
      content: '<i class="DUMMY-content"></i>',
      extra: '<i class="DUMMY-extra"></i>',
      ...slots,
    },
  });
  return wrapper;
}

/**
 * 取侧边栏元素。
 * @param target 已挂载的布局包装器。
 * @returns 侧边栏元素包装器。
 */
function sidebar(target: ReturnType<typeof mount>) {
  return target.find('aside');
}

/**
 * 在侧边栏上派发一次真实悬停事件。
 * happy-dom 不计算布局，offsetX 取不到，这里按浏览器契约注入鼠标相对左边缘的偏移。
 * @param target 已挂载的布局包装器。
 * @param offsetX 鼠标相对侧边栏左边缘的横向偏移。
 */
function hoverSidebar(target: ReturnType<typeof mount>, offsetX: number) {
  const event = new MouseEvent('mouseenter');
  Object.defineProperty(event, 'offsetX', {
    configurable: true,
    value: offsetX,
  });
  sidebar(target).element.dispatchEvent(event);
}

/**
 * 取内容列元素（承载顶栏、标签栏、内容区与页脚）。
 * @param target 已挂载的布局包装器。
 * @returns 内容列元素。
 */
function contentColumn(target: ReturnType<typeof mount>) {
  return target.find('.flex.flex-1.flex-col').element as HTMLElement;
}

/**
 * 取顶栏外层容器：它是顶栏组件的父元素，承载顶栏与标签栏的定位样式。
 * @param target 已挂载的布局包装器。
 * @returns 顶栏外层容器的行内样式。
 */
function headerWrapperStyle(target: ReturnType<typeof mount>) {
  const column = contentColumn(target);
  const headerBox = column.firstElementChild as HTMLElement | null;
  return headerBox?.getAttribute('style') ?? '';
}

/**
 * 取内容区元素，用于读取浏览器归一化后的行内样式。
 * @param target 已挂载的布局包装器。
 * @returns 内容区元素。
 */
function contentElement(target: ReturnType<typeof mount>) {
  return target.findComponent(LayoutContent).element as HTMLElement;
}

afterEach(
  /** 卸载布局、清空布局变量并复位注入的滚动量，避免用例之间互相影响。 */ () => {
    wrapper?.unmount();
    wrapper = undefined;
    document.documentElement.style.removeProperty('--vben-header-height');
    document.documentElement.style.removeProperty('--vben-footer-height');
    Object.defineProperty(document.documentElement, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(document.body, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    });
  },
);

describe('后台布局区域与尺寸', /** 区域尺寸决定页面是否互相遮挡。 */ () => {
  it('侧边导航渲染侧边栏、顶栏、标签栏与内容插槽', /** 区域缺失会让导航或页面内容整块消失。 */ () => {
    const layout = mountLayout();

    expect(layout.findComponent(LayoutSidebar).exists()).toBe(true);
    expect(layout.findComponent(LayoutHeader).exists()).toBe(true);
    expect(layout.findComponent(LayoutTabbar).exists()).toBe(true);
    expect(layout.findComponent(LayoutFooter).exists()).toBe(false);
    expect(layout.find('#DUMMY').exists()).toBe(false);
    expect(layout.find('.DUMMY-content').exists()).toBe(true);
    expect(layout.find('.DUMMY-extra').exists()).toBe(true);
    expect(layout.find(`#${ELEMENT_ID_MAIN_CONTENT}`).exists()).toBe(true);
  });

  it('内容区宽高变量按顶栏与页脚高度写入', /** 变量缺失会让内容区高度计算错误而出现双滚动条。 */ async () => {
    const layout = mountLayout({
      footerEnable: true,
      footerHeight: 48,
      headerHeight: 60,
      tabbarHeight: 44,
    });
    await nextTick();

    expect(
      document.documentElement.style.getPropertyValue('--vben-header-height'),
    ).toBe('104px');
    expect(
      document.documentElement.style.getPropertyValue('--vben-footer-height'),
    ).toBe('48px');
    expect(layout.findComponent(LayoutFooter).exists()).toBe(true);
  });

  it('隐藏顶栏与关闭标签栏后顶栏容器高度只算可见部分', /** 高度多算会让内容区顶部留出空白。 */ () => {
    const noHeader = mountLayout({ headerVisible: false });

    expect(noHeader.findComponent(LayoutHeader).exists()).toBe(false);
    expect(headerWrapperStyle(noHeader)).toContain(
      `height: ${TABBAR_HEIGHT}px`,
    );

    wrapper?.unmount();

    const noTabbar = mountLayout({ tabbarEnable: false });
    expect(noTabbar.findComponent(LayoutTabbar).exists()).toBe(false);
    expect(headerWrapperStyle(noTabbar)).toContain(
      `height: ${HEADER_HEIGHT}px`,
    );
  });

  it('全屏内容布局不渲染侧边栏与顶栏并收起顶栏容器', /** 全屏布局仍留顶栏空隙会让用户看到一条空白横条。 */ () => {
    const layout = mountLayout({ layout: 'full-content' });

    // 全屏布局仍渲染侧边区域，但整体不显示，顶栏容器收起为零高度。
    expect(layout.findComponent(LayoutSidebar).props('show')).toBe(false);
    expect(layout.findComponent(LayoutHeader).props('show')).toBe(false);
    expect(headerWrapperStyle(layout)).toContain('height: 0');
    expect(headerWrapperStyle(layout)).toContain(
      `top: -${HEADER_HEIGHT + TABBAR_HEIGHT}px`,
    );
  });

  it('顶栏导航模式渲染整宽顶栏且不渲染侧边栏', /** 顶栏导航误留侧边栏会让页面出现两套导航。 */ () => {
    const layout = mountLayout({ layout: 'header-nav' });

    expect(layout.findComponent(LayoutSidebar).exists()).toBe(false);
    expect(layout.findComponent(LayoutHeader).props('fullWidth')).toBe(true);
    // 顶栏导航下 logo 移到顶栏，侧边栏不再承载品牌区。
    expect(layout.findComponent(LayoutHeader).props('width')).toBe('100%');
  });

  it('关闭侧边栏开关后不渲染侧边区域', /** 关闭开关仍渲染会让页面残留一条空侧边。 */ () => {
    const layout = mountLayout({ sidebarEnable: false });

    expect(layout.findComponent(LayoutSidebar).exists()).toBe(false);
  });

  it('隐藏侧边栏时宽度归零但仍保留占位', /** 隐藏未归零会让内容区被压窄。 */ () => {
    const layout = mountLayout({ sidebarHidden: true });

    expect(layout.findComponent(LayoutSidebar).props('width')).toBe(0);
    expect(layout.findComponent(LayoutSidebar).props('show')).toBe(false);
  });

  it('折叠侧边栏按折叠宽度收窄，移动端折叠后宽度为 0', /** 折叠宽度算错会让侧边栏挤出内容区。 */ () => {
    const collapsed = mountLayout({ sidebarCollapse: true });
    expect(collapsed.findComponent(LayoutSidebar).props('width')).toBe(
      SIDE_COLLAPSE_WIDTH,
    );

    wrapper?.unmount();

    const mobile = mountLayout({ isMobile: true, sidebarCollapse: true });
    expect(mobile.findComponent(LayoutSidebar).props('width')).toBe(0);
  });

  it('折叠时显示标题或混合导航使用混合宽度', /** 折叠宽度选错会让折叠后的标题被截断。 */ () => {
    const showTitle = mountLayout({
      sidebarCollapse: true,
      sidebarCollapseShowTitle: true,
    });
    expect(showTitle.findComponent(LayoutSidebar).props('collapseWidth')).toBe(
      SIDEBAR_MIXED_WIDTH,
    );

    wrapper?.unmount();

    const mixed = mountLayout({ layout: 'sidebar-mixed-nav' });
    expect(mixed.findComponent(LayoutSidebar).props('width')).toBe(
      SIDEBAR_MIXED_WIDTH,
    );
  });

  it('混合导航下侧边栏顶部让出顶栏高度', /** 未让出高度会让侧边栏顶部被顶栏遮住。 */ () => {
    const mixed = mountLayout({ layout: 'mixed-nav' });
    expect(mixed.findComponent(LayoutSidebar).props('marginTop')).toBe(
      HEADER_HEIGHT,
    );

    wrapper?.unmount();

    const headerMixed = mountLayout({ layout: 'header-mixed-nav' });
    expect(headerMixed.findComponent(LayoutSidebar).props('marginTop')).toBe(0);
  });

  it('移动端隐藏侧边栏 DOM 但保留侧边区域', /** 移动端保留 DOM 会让抽屉关闭后侧边栏仍占位。 */ () => {
    const layout = mountLayout({ isMobile: true });

    expect(layout.findComponent(LayoutSidebar).props('domVisible')).toBe(false);
  });

  it('扩展区宽度随扩展折叠状态切换', /** 扩展区宽度不切换会让折叠按钮点了没反应。 */ () => {
    const expanded = mountLayout({ sidebarExtraCollapse: false });
    expect(expanded.findComponent(LayoutSidebar).props('extraWidth')).toBe(
      SIDEBAR_WIDTH,
    );

    wrapper?.unmount();

    const collapsed = mountLayout({ sidebarExtraCollapse: true });
    expect(collapsed.findComponent(LayoutSidebar).props('extraWidth')).toBe(60);
  });

  it('侧边层级在移动端与混合导航下抬高', /** 层级算错会让遮罩盖住侧边栏。 */ () => {
    const desktop = mountLayout();
    expect(desktop.findComponent(LayoutSidebar).props('zIndex')).toBe(201);

    wrapper?.unmount();

    const mixed = mountLayout({ layout: 'mixed-nav' });
    expect(mixed.findComponent(LayoutSidebar).props('zIndex')).toBe(202);

    wrapper?.unmount();

    const fullContent = mountLayout({ layout: 'full-content' });
    expect(fullContent.findComponent(LayoutSidebar).props('zIndex')).toBe(199);
  });
});

describe('后台布局内容区样式', /** 内容区边距决定内容是否被顶栏或页脚遮挡。 */ () => {
  it('固定顶栏时内容区让出顶栏与标签栏高度', /** 未让出高度会让内容被顶栏盖住。 */ () => {
    const layout = mountLayout();

    expect(contentElement(layout).style.marginTop).toBe(
      `${HEADER_HEIGHT + TABBAR_HEIGHT}px`,
    );
  });

  it('非固定顶栏时内容区不留上边距', /** 多留边距会让静态顶栏下方出现空隙。 */ () => {
    const layout = mountLayout({ headerMode: 'static' });

    expect(contentElement(layout).style.marginTop).toBe('0px');
  });

  it('固定页脚时内容区让出页脚高度', /** 未让出高度会让内容被固定页脚盖住。 */ () => {
    const layout = mountLayout({
      footerEnable: true,
      footerFixed: true,
      footerHeight: 48,
    });

    expect(contentElement(layout).style.paddingBottom).toBe('48px');
  });

  it('非固定页脚时内容区不让出高度且页脚宽度占满', /** 宽度算错会让页脚在非固定模式下错位。 */ () => {
    const layout = mountLayout({ footerEnable: true, footerFixed: false });

    expect(contentElement(layout).style.paddingBottom).toBe('0px');
    expect(layout.findComponent(LayoutFooter).props('width')).toBe('100%');
  });

  it('固定页脚宽度跟随内容区宽度', /** 页脚宽度与内容区不一致会让页脚压在侧边栏上。 */ () => {
    const layout = mountLayout({ footerEnable: true, footerFixed: true });

    expect(layout.findComponent(LayoutFooter).props('width')).toBe(
      `calc(100% - ${SIDEBAR_WIDTH}px)`,
    );
  });

  it('标签栏在混合导航下按侧边宽度偏移', /** 偏移算错会让标签栏压在侧边菜单上。 */ () => {
    const layout = mountLayout({ layout: 'mixed-nav' });

    // 未开启悬停展开时，混合导航按折叠宽度偏移标签栏。
    expect(layout.findComponent(LayoutTabbar).attributes('style')).toContain(
      `margin-left: ${SIDE_COLLAPSE_WIDTH}px`,
    );
    expect(layout.findComponent(LayoutTabbar).attributes('style')).toContain(
      `width: calc(100% - ${SIDE_COLLAPSE_WIDTH}px)`,
    );
  });

  it('混合导航隐藏侧边栏时标签栏占满整宽', /** 隐藏侧边后仍偏移会让标签栏右侧留空。 */ () => {
    const layout = mountLayout({
      layout: 'mixed-nav',
      sidebarHidden: true,
    });

    expect(layout.findComponent(LayoutTabbar).attributes('style')).toContain(
      'width: 100%',
    );
  });

  it('混合导航关闭侧边栏时标签栏占满整宽', /** 关闭侧边后仍偏移会让标签栏错位。 */ () => {
    const layout = mountLayout({
      layout: 'mixed-nav',
      sidebarEnable: false,
    });

    expect(layout.findComponent(LayoutTabbar).attributes('style')).toContain(
      'width: 100%',
    );
  });

  it('混合导航折叠侧边栏时标签栏按折叠宽度偏移', /** 折叠后仍按展开宽度偏移会让标签栏错位。 */ () => {
    const layout = mountLayout({
      layout: 'mixed-nav',
      sidebarCollapse: true,
      sidebarCollapseShowTitle: true,
    });

    expect(layout.findComponent(LayoutTabbar).attributes('style')).toContain(
      `margin-left: ${SIDEBAR_MIXED_WIDTH}px`,
    );
  });

  it('悬停展开侧边栏时标签栏按悬停宽度收窄', /** 悬停宽度算错会让标签栏与侧边栏重叠。 */ () => {
    const layout = mountLayout({
      layout: 'mixed-nav',
      sidebarExpandOnHover: true,
    });

    expect(layout.findComponent(LayoutTabbar).attributes('style')).toContain(
      `margin-left: ${SIDEBAR_WIDTH}px`,
    );
  });

  it('内容区让出侧边宽度并把宽度交给顶栏', /** 宽度算错会让顶栏与内容区错位。 */ () => {
    const layout = mountLayout();

    expect(headerWrapperStyle(layout)).toContain(
      `width: calc(100% - ${SIDEBAR_WIDTH}px)`,
    );
  });

  it('悬停展开侧边栏时内容区同时让出两列宽度', /** 两列宽度算错会让内容被第二列菜单盖住。 */ () => {
    const layout = mountLayout({
      layout: 'sidebar-mixed-nav',
      sidebarExpandOnHover: true,
      sidebarExtraVisible: true,
    });

    expect(headerWrapperStyle(layout)).toContain(
      `width: calc(100% - ${SIDEBAR_MIXED_WIDTH + SIDEBAR_WIDTH}px)`,
    );
  });

  it('悬停展开且折叠时按两个折叠宽度让位', /** 折叠后仍按展开宽度让位会让内容区被压窄。 */ () => {
    const layout = mountLayout({
      layout: 'sidebar-mixed-nav',
      sidebarCollapse: true,
      sidebarExpandOnHover: true,
      sidebarExtraCollapse: true,
      sidebarExtraVisible: true,
    });

    // 折叠宽度取混合宽度（80），扩展区取扩展折叠宽度（60）。
    expect(headerWrapperStyle(layout)).toContain(
      `width: calc(100% - ${SIDEBAR_MIXED_WIDTH + 60}px)`,
    );
  });

  it('悬停侧边栏时按折叠宽度让位，移出后恢复并抛出事件', /** 悬停让位算错会让内容区在鼠标经过时抖动。 */ async () => {
    const layout = mountLayout({
      layout: 'sidebar-mixed-nav',
      sidebarExpandOnHover: false,
    });
    await nextTick();

    hoverSidebar(layout, 20);
    await nextTick();

    // 悬停时按折叠宽度让位，避免内容区在鼠标经过时被推开又弹回。
    expect(headerWrapperStyle(layout)).toContain(
      `width: calc(100% - ${SIDEBAR_MIXED_WIDTH}px)`,
    );

    await sidebar(layout).trigger('mouseleave');
    await nextTick();

    expect(layout.emitted('sideMouseLeave')).toHaveLength(1);
    expect(headerWrapperStyle(layout)).toContain(
      `width: calc(100% - ${SIDEBAR_MIXED_WIDTH}px)`,
    );
  });
});

describe('后台布局顶栏与遮罩交互', /** 交互决定移动端与自动隐藏顶栏是否可用。 */ () => {
  it('移动端未折叠时渲染遮罩并点击折叠侧边栏', /** 遮罩点不掉会让移动端页面无法关闭侧边栏。 */ async () => {
    const layout = mountLayout({ isMobile: true, sidebarCollapse: true });
    // 移动端进入时自动折叠，手动展开后才出现遮罩。
    await layout.setProps({ sidebarCollapse: false });
    const mask = layout.find('.bg-overlay');

    expect(mask.exists()).toBe(true);

    await mask.trigger('click');
    await nextTick();

    expect(layout.emitted('update:sidebarCollapse')?.at(-1)).toEqual([true]);
  });

  it('侧边栏折叠后移动端遮罩消失', /** 遮罩不消失会让移动端页面一直发暗。 */ () => {
    const layout = mountLayout({ isMobile: true, sidebarCollapse: true });

    expect(layout.find('.bg-overlay').exists()).toBe(false);
  });

  it('移动端点击顶栏切换按钮展开侧边栏', /** 移动端点击无反应会让用户打不开菜单。 */ async () => {
    const layout = mountLayout({ isMobile: true });
    // 移动端进入时自动折叠，点击切换按钮必须重新展开。
    expect(layout.emitted('update:sidebarCollapse')?.[0]).toEqual([true]);

    await layout.find('header button').trigger('click');
    await nextTick();

    expect(layout.emitted('update:sidebarCollapse')?.at(-1)).toEqual([false]);
  });

  it('桌面端点击顶栏切换按钮向外抛出事件', /** 桌面端不抛事件会让偏好无法写回。 */ async () => {
    const layout = mountLayout();

    await layout.find('header button').trigger('click');
    await nextTick();

    expect(layout.emitted('toggleSidebar')).toHaveLength(1);
  });

  it('点击侧边栏折叠按钮切换折叠状态', /** 折叠状态不回传会让偏好设置与界面不一致。 */ async () => {
    const layout = mountLayout({ sidebarCollapse: false });
    await nextTick();

    await sidebar(layout).find('.bottom-2.left-3').trigger('click');
    await nextTick();

    expect(layout.emitted('update:sidebarCollapse')).toHaveLength(1);
  });

  it('点击固定按钮切换悬停展开偏好', /** 固定按钮不回传会让用户下次进入仍要重新钉住侧边栏。 */ async () => {
    const layout = mountLayout({ sidebarExpandOnHover: false });
    await nextTick();

    await sidebar(layout).find('.bottom-2.right-3').trigger('click');
    await nextTick();

    expect(layout.emitted('update:sidebarExpandOnHover')).toHaveLength(1);
  });

  it('双列布局点击扩展区折叠按钮切换扩展折叠', /** 扩展区折叠不回传会让第二列收不起来。 */ async () => {
    const layout = mountLayout({
      layout: 'sidebar-mixed-nav',
      sidebarExpandOnHover: true,
      sidebarExtraCollapse: false,
    });
    await nextTick();

    // 双列布局里扩展区折叠按钮是唯一的折叠按钮。
    await sidebar(layout).find('.bottom-2.left-3').trigger('click');
    await nextTick();

    expect(layout.emitted('update:sidebarExtraCollapse')).toHaveLength(1);
  });

  it('关闭顶栏切换按钮后不再渲染该按钮', /** 开关失效会让用户仍看到被关掉的按钮。 */ () => {
    const layout = mountLayout({ headerToggleSidebarButton: false });

    expect(layout.find('header button').exists()).toBe(false);
  });

  it('移动端始终渲染顶栏切换按钮', /** 移动端缺少按钮会让用户无法打开菜单。 */ () => {
    const layout = mountLayout({
      headerToggleSidebarButton: false,
      isMobile: true,
    });

    expect(layout.find('header button').exists()).toBe(true);
  });

  it('顶栏自动模式下鼠标移出顶栏区域时隐藏顶栏', /** 自动隐藏失效会让顶栏一直占用阅读空间。 */ async () => {
    const layout = mountLayout({
      headerMode: 'auto',
      isMobile: false,
      layout: 'sidebar-nav',
    });
    // 鼠标监听在首帧渲染后才挂到内容列上，先等一次渲染再派发移动事件。
    await nextTick();

    contentColumn(layout).dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientY: 300 }),
    );
    await nextTick();

    expect(headerWrapperStyle(layout)).toContain(
      `top: -${HEADER_HEIGHT + TABBAR_HEIGHT}px`,
    );

    contentColumn(layout).dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientY: 5 }),
    );
    await nextTick();

    expect(headerWrapperStyle(layout)).toContain('top: 0px');
  });

  it('非自动模式下鼠标移动不隐藏顶栏', /** 固定顶栏被隐藏会让用户找不到导航。 */ async () => {
    const layout = mountLayout({ headerMode: 'fixed' });
    await nextTick();

    contentColumn(layout).dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientY: 300 }),
    );
    await nextTick();

    expect(headerWrapperStyle(layout)).toContain('top: 0px');
  });

  it('顶栏自动模式下内容区跟随鼠标位置让出高度', /** 鼠标在顶栏区域内时内容区必须让出高度。 */ async () => {
    const layout = mountLayout({ headerMode: 'auto' });
    await nextTick();

    contentColumn(layout).dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientY: 5 }),
    );
    await nextTick();

    expect(contentElement(layout).style.marginTop).toBe(
      `${HEADER_HEIGHT + TABBAR_HEIGHT}px`,
    );
  });
});

describe('后台布局滚动行为', /** 滚动方向决定自动隐藏的顶栏何时出现。 */ () => {
  /**
   * 注入文档滚动位置；happy-dom 不排版，因此按浏览器契约直接写入滚动量。
   * @param top 目标滚动位置。
   */
  function scrollTo(top: number) {
    Object.defineProperty(document.documentElement, 'scrollTop', {
      configurable: true,
      value: top,
    });
    Object.defineProperty(document.body, 'scrollTop', {
      configurable: true,
      value: top,
    });
    document.dispatchEvent(new Event('scroll'));
  }

  /** 节流窗口：组件对滚动回调做了 300 毫秒节流，等待它过去才能让下一次滚动成为前导调用。 */
  const THROTTLE_WINDOW = 350;

  it('向下滚动越过顶栏隐藏顶栏，向上滚动重新显示', /** 只隐藏不恢复会让用户无法唤出导航。 */ async () => {
    const layout = mountLayout({ headerMode: 'auto-scroll' });

    // 滚动量仍在顶栏高度内，顶栏保持显示。
    scrollTo(50);
    await nextTick();
    expect(headerWrapperStyle(layout)).toContain('top: 0px');

    await new Promise(
      /** 等过节流窗口，让下一次滚动重新成为前导调用。 */ (resolve) =>
        setTimeout(resolve, THROTTLE_WINDOW),
    );

    // 越过顶栏高度且继续向下滚动时隐藏顶栏。
    scrollTo(400);
    await nextTick();
    expect(headerWrapperStyle(layout)).toContain(
      `top: -${HEADER_HEIGHT + TABBAR_HEIGHT}px`,
    );

    await new Promise(
      /** 等过节流窗口，让回滚重新成为前导调用。 */ (resolve) =>
        setTimeout(resolve, THROTTLE_WINDOW),
    );

    // 向上滚动但未回到顶部时重新显示顶栏。
    scrollTo(200);
    await nextTick();
    expect(headerWrapperStyle(layout)).toContain('top: 0px');
  });
});
