/**
 * 布局侧边栏（layout-ui 的 components/layout-sidebar）样式、折叠与混合菜单真实行为回归。
 *
 * 侧边栏承载主导航，并按折叠、悬浮展开、混合菜单三种状态切换宽度与占位：宽度或占位算错会让
 * 导航遮住内容区、折叠后留下空白列；悬浮展开的进入/离开判定写反会让侧栏莫名收起或无法展开；
 * 混合模式下扩展面板的折叠与固定按钮失灵会让双列导航整块不可用；离开事件不发出会让父布局
 * 无法同步侧栏状态。用例用真实双向绑定挂载组件，读取真实渲染出的内联样式、真实 DOM 分支与
 * 真实模型变化，滚动锁定也断言到真实的页面样式上。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { VbenScrollbar } from '@vben-core/shadcn-ui';

import { afterEach, describe, expect, it, vi } from 'vitest';

import LayoutSidebar from '../layout-sidebar.vue';
import { SidebarCollapseButton, SidebarFixedButton } from '../widgets';

/** 侧边栏的基准属性：非混合模式、宽 210、扩展区宽 200、头部高 50。 */
const baseProps = {
  extraWidth: 200,
  headerHeight: 50,
  theme: 'light',
  width: 210,
};

/**
 * 挂载带真实双向绑定的侧边栏宿主。
 * @param props 覆盖的侧边栏属性。
 * @param slots 需要渲染的插槽渲染函数。
 * @param initial 需要覆盖的模型初始值。
 * @returns 宿主包装器、模型读取器与离开事件记录。
 */
function mountSidebar(
  props: Record<string, unknown> = {},
  slots: Record<string, unknown> = {},
  initial: Partial<{
    collapse: boolean;
    expandOnHover: boolean;
    expandOnHovering: boolean;
    extraCollapse: boolean;
    extraVisible: boolean;
  }> = {},
) {
  const collapse = ref(initial.collapse ?? false);
  const extraCollapse = ref(initial.extraCollapse ?? false);
  const expandOnHover = ref(initial.expandOnHover ?? false);
  const expandOnHovering = ref(initial.expandOnHovering ?? false);
  const extraVisible = ref(initial.extraVisible ?? false);
  const leave = vi.fn();

  const Host = defineComponent({
    name: 'SidebarHost',
    /**
     * 组装宿主：把真实模型传给侧边栏并接收侧边栏回写的值。
     * @returns 渲染真实侧边栏的渲染函数。
     */
    setup() {
      return /** 渲染带真实双向绑定的侧边栏。 */ () =>
        h('div', { class: 'probe-host' }, [
          h(
            LayoutSidebar,
            {
              ...baseProps,
              ...props,
              collapse: collapse.value,
              extraCollapse: extraCollapse.value,
              expandOnHover: expandOnHover.value,
              expandOnHovering: expandOnHovering.value,
              extraVisible: extraVisible.value,
              /** 回写折叠状态。 */
              'onUpdate:collapse': (value?: boolean) => {
                collapse.value = value ?? false;
              },
              /** 回写扩展面板折叠状态。 */
              'onUpdate:extraCollapse': (value?: boolean) => {
                extraCollapse.value = value ?? false;
              },
              /** 回写悬浮展开固定状态。 */
              'onUpdate:expandOnHover': (value?: boolean) => {
                expandOnHover.value = value ?? false;
              },
              /** 回写悬浮展开状态。 */
              'onUpdate:expandOnHovering': (value?: boolean) => {
                expandOnHovering.value = value ?? false;
              },
              /** 回写扩展面板可见状态。 */
              'onUpdate:extraVisible': (value?: boolean) => {
                extraVisible.value = value ?? false;
              },
              onLeave: leave,
            },
            slots,
          ),
        ]);
    },
  });

  return {
    leave,
    models: {
      collapse,
      expandOnHover,
      expandOnHovering,
      extraCollapse,
      extraVisible,
    },
    wrapper: mount(Host),
  };
}

/**
 * 读取侧边栏根元素。
 * @param wrapper 已挂载的侧边栏宿主。
 * @returns 侧边栏根元素包装器。
 * @throws 侧边栏未渲染时抛出，避免断言落到 undefined 上。
 */
function asideOf(wrapper: ReturnType<typeof mount>) {
  const aside = wrapper.find<HTMLElement>('aside');
  if (!aside.exists()) {
    throw new Error('侧边栏根元素未渲染');
  }
  return aside;
}

/**
 * 读取隐藏态占位元素（侧栏折叠时占住页面宽度的那一列）。
 * @param wrapper 已挂载的侧边栏宿主。
 * @returns 隐藏态占位元素包装器。
 * @throws 占位元素未渲染时抛出。
 */
function hiddenOf(wrapper: ReturnType<typeof mount>) {
  const hidden = wrapper.find<HTMLElement>('.probe-host > div');
  if (!hidden.exists()) {
    throw new Error('隐藏态占位元素未渲染');
  }
  return hidden;
}

/**
 * 读取混合模式下的扩展面板元素。
 * @param wrapper 已挂载的侧边栏宿主。
 * @returns 扩展面板元素。
 * @throws 扩展面板未渲染时抛出。
 */
function extraPanelOf(wrapper: ReturnType<typeof mount>): HTMLElement {
  const aside = asideOf(wrapper).element;
  const panel = [...aside.querySelectorAll<HTMLElement>('div')].find(
    /** 按侧栏底色与溢出裁剪类名定位扩展面板（只认侧栏的直接子元素）。 */ (
      element,
    ) =>
      element.parentElement === aside &&
      element.className.includes('bg-sidebar') &&
      element.className.includes('overflow-hidden'),
  );
  if (!panel) {
    throw new Error('扩展面板未渲染');
  }
  return panel;
}

/**
 * 统计侧边栏内指定内联高度的占位条数量。
 * @param wrapper 已挂载的侧边栏宿主。
 * @param height 目标内联高度。
 * @returns 命中的占位条数量。
 */
function countBars(wrapper: ReturnType<typeof mount>, height: string) {
  return [
    ...asideOf(wrapper).element.querySelectorAll<HTMLElement>('div'),
  ].filter(
    /** 按内联高度筛选占位条。 */ (element) => element.style.height === height,
  ).length;
}

afterEach(
  /** 卸载宿主并解锁页面滚动，避免残留影响后续用例。 */ () => {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  },
);

describe('侧边栏基础渲染', /** 占位、侧栏与插槽决定导航骨架能否撑起页面。 */ () => {
  it('渲染隐藏占位、侧栏与全部插槽', /** 任一骨架元素缺失都会让导航错位或整块丢失。 */ () => {
    const { wrapper } = mountSidebar(
      { show: true },
      {
        /** 菜单插槽：承载导航菜单内容。 */
        default: /** 渲染菜单内容。 */ () =>
          h('div', { class: 'probe-menu' }, 'DUMMY-菜单'),
        /** 品牌区插槽：承载顶栏下方的品牌信息。 */
        logo: /** 渲染品牌区内容。 */ () =>
          h('div', { class: 'probe-logo' }, 'DUMMY-品牌'),
      },
    );

    const hidden = hiddenOf(wrapper);
    expect(hidden.classes()).toContain('h-full');
    expect(hidden.classes()).toContain('light');

    const aside = asideOf(wrapper);
    expect(aside.classes()).toContain('light');
    expect(aside.classes()).toContain('border-r');
    expect(aside.classes()).toContain('bg-sidebar');
    expect(aside.classes()).not.toContain('bg-sidebar-deep');

    expect(wrapper.get('.probe-logo').text()).toBe('DUMMY-品牌');
    expect(wrapper.get('.probe-menu').text()).toBe('DUMMY-菜单');

    wrapper.unmount();
  });

  it('按属性渲染侧栏宽度、层级与内边距', /** 宽度写错会让侧栏遮住内容区，层级写错会被内容盖住。 */ () => {
    const { wrapper } = mountSidebar({ paddingTop: 12, zIndex: 120 });

    const style = asideOf(wrapper).element.style;
    expect(style.width).toBe('210px');
    expect(style.minWidth).toBe('210px');
    expect(style.maxWidth).toBe('210px');
    expect(style.flex).toBe('0 0 210px');
    expect(style.marginLeft).toBe('0px');
    expect(style.height).toBe('calc(100% - 0px)');
    expect(style.marginTop).toBe('0px');
    expect(style.paddingTop).toBe('12px');
    expect(style.zIndex).toBe('120');
    expect(style.getPropertyValue('--scroll-shadow')).toBe('var(--sidebar)');

    wrapper.unmount();
  });

  it('折叠区按折叠高度撑开占位条', /** 折叠区高度丢失会让底部按钮压在菜单上。 */ () => {
    const { wrapper } = mountSidebar({ collapseHeight: 36 });

    expect(countBars(wrapper, '36px')).toBe(1);

    wrapper.unmount();
  });

  it('头部区域按插槽渲染并留出高度', /** 未提供品牌区仍渲染头部会在顶栏下方留出空带。 */ () => {
    const { wrapper } = mountSidebar();

    // 头部容器依赖 logo 插槽，缺失时不应渲染出 headerHeight - 1 的占位。
    expect(countBars(wrapper, '49px')).toBe(0);

    wrapper.unmount();
  });

  it('提供 logo 插槽时渲染头部并留出高度', /** 头部高度算错会让品牌区与顶栏高低不一致。 */ () => {
    const { wrapper } = mountSidebar(
      {},
      {
        /** 品牌区插槽：承载品牌信息。 */
        logo: /** 渲染品牌区内容。 */ () =>
          h('div', { class: 'probe-logo' }, 'DUMMY-品牌'),
      },
    );

    expect(countBars(wrapper, '49px')).toBe(1);

    wrapper.unmount();
  });

  it('内容区与扩展区滚动容器按头部与折叠区留白', /** 滚动区高度算错会让菜单底部被折叠按钮遮住。 */ () => {
    const { wrapper } = mountSidebar(
      { collapseHeight: 30, headerHeight: 60, isSidebarMixed: true },
      {
        /** 扩展区插槽：承载混合菜单的第二列。 */
        extra: /** 渲染扩展区内容。 */ () =>
          h('div', { class: 'probe-extra' }, 'DUMMY-扩展'),
      },
    );

    const scrollbars = wrapper.findAllComponents(VbenScrollbar);
    expect(scrollbars.length).toBe(2);
    // 主内容区高度 = 100% -（头部 + 折叠区），并额外留出 8px 顶部间距。
    expect(scrollbars[0]?.element.style.height).toBe('calc(100% - 90px)');
    expect(scrollbars[0]?.element.style.paddingTop).toBe('8px');
    expect(scrollbars[1]?.element.style.height).toBe('calc(100% - 90px)');

    wrapper.unmount();
  });

  it('隐藏态可关闭且只影响占位元素', /** 隐藏态占位不可关闭会让页面在侧栏收起后仍留白。 */ () => {
    const { wrapper } = mountSidebar({ domVisible: false });

    expect(wrapper.find('.probe-host > div').exists()).toBe(false);
    expect(asideOf(wrapper).exists()).toBe(true);

    wrapper.unmount();
  });

  it('宽度为 0 时收起为 0 并隐藏溢出', /** 宽度 0 未隐藏溢出会让内部菜单溢出到内容区。 */ () => {
    const { wrapper } = mountSidebar({ width: 0 });

    const style = asideOf(wrapper).element.style;
    expect(style.width).toBe('0px');
    expect(style.marginLeft).toBe('0px');
    expect(style.overflow).toBe('hidden');
    expect(hiddenOf(wrapper).element.style.flex).toBe('0 0 0px');

    wrapper.unmount();
  });

  it('隐藏时整体左移自身宽度', /** 隐藏不上移会让侧栏继续占据页面左侧。 */ () => {
    const { wrapper } = mountSidebar({ show: false, width: 240 });

    const style = asideOf(wrapper).element.style;
    expect(style.marginLeft).toBe('-240px');
    expect(style.width).toBe('240px');

    wrapper.unmount();
  });

  it('悬浮展开未固定时隐藏占位收窄为折叠宽度', /** 占位不收窄会让内容区在悬浮展开时被挤走。 */ () => {
    const { wrapper } = mountSidebar(
      { collapseWidth: 52 },
      {},
      { expandOnHover: false, expandOnHovering: true },
    );

    expect(hiddenOf(wrapper).element.style.flex).toBe('0 0 52px');
    // 已固定悬浮展开时占位保持完整宽度。
    expect(asideOf(wrapper).element.style.flex).toBe('0 0 210px');

    wrapper.unmount();
  });

  it('已固定悬浮展开时隐藏占位保持完整宽度', /** 固定后仍收窄占位会让菜单在悬浮时压住内容。 */ () => {
    const { wrapper } = mountSidebar(
      {},
      {},
      { expandOnHover: true, expandOnHovering: true },
    );

    expect(hiddenOf(wrapper).element.style.flex).toBe('0 0 210px');

    wrapper.unmount();
  });
});

describe('侧边栏折叠与悬浮交互', /** 折叠按钮、悬浮进出与事件决定导航能否被正确展开与收起。 */ () => {
  it('折叠按钮驱动折叠状态并收起固定按钮', /** 折叠按钮失效会让用户无法收起导航。 */ async () => {
    const { models, wrapper } = mountSidebar();

    expect(wrapper.findComponent(SidebarFixedButton).exists()).toBe(true);

    await wrapper.findComponent(SidebarCollapseButton).trigger('click');

    expect(models.collapse.value).toBe(true);
    // 折叠后不再渲染悬浮固定按钮，避免折叠态出现无效入口。
    expect(wrapper.findComponent(SidebarFixedButton).exists()).toBe(false);

    wrapper.unmount();
  });

  it('固定按钮切换悬浮展开', /** 固定按钮失效会让用户无法锁定悬浮展开。 */ async () => {
    const { models, wrapper } = mountSidebar();

    await wrapper.findComponent(SidebarFixedButton).trigger('click');

    expect(models.expandOnHover.value).toBe(true);
    expect(models.expandOnHovering.value).toBe(false);

    wrapper.unmount();
  });

  it('鼠标从左边缘进入时不触发展开', /** 贴边进入被判成悬浮会让侧栏在误触时抖动。 */ async () => {
    const { models, wrapper } = mountSidebar({}, {}, { collapse: true });

    await asideOf(wrapper).trigger('mouseenter', { offsetX: 5 });

    expect(models.collapse.value).toBe(true);
    expect(models.expandOnHovering.value).toBe(false);

    wrapper.unmount();
  });

  it('鼠标进入时展开并登记悬浮状态', /** 进入不展开会让折叠态菜单无法使用。 */ async () => {
    const { models, wrapper } = mountSidebar({}, {}, { collapse: true });

    await asideOf(wrapper).trigger('mouseenter', { offsetX: 20 });

    expect(models.collapse.value).toBe(false);
    expect(models.expandOnHovering.value).toBe(true);

    wrapper.unmount();
  });

  it('已固定悬浮展开时进入不改写折叠状态', /** 固定状态下改写折叠会让用户锁定的展开被打回。 */ async () => {
    const { models, wrapper } = mountSidebar({}, {}, { expandOnHover: true });

    await asideOf(wrapper).trigger('mouseenter', { offsetX: 20 });

    expect(models.collapse.value).toBe(false);
    expect(models.expandOnHovering.value).toBe(false);

    wrapper.unmount();
  });

  it('已处于悬浮展开时进入不改写折叠状态', /** 重复进入改写折叠会让展开后的侧栏突然收起。 */ async () => {
    const { models, wrapper } = mountSidebar(
      {},
      {},
      { collapse: true, expandOnHovering: true },
    );

    await asideOf(wrapper).trigger('mouseenter', { offsetX: 20 });

    expect(models.collapse.value).toBe(true);
    expect(models.expandOnHovering.value).toBe(true);

    wrapper.unmount();
  });

  it('鼠标离开时发出事件并收起侧栏', /** 离开不收起会让侧栏长期遮住内容，不发出事件会让父布局状态不同步。 */ async () => {
    const { leave, models, wrapper } = mountSidebar(
      {},
      {},
      { collapse: false, expandOnHovering: true, extraVisible: true },
    );

    await asideOf(wrapper).trigger('mouseleave');

    expect(leave).toHaveBeenCalledTimes(1);
    expect(models.collapse.value).toBe(true);
    expect(models.expandOnHovering.value).toBe(false);
    expect(models.extraVisible.value).toBe(false);

    wrapper.unmount();
  });

  it('已固定悬浮展开时离开只发出事件', /** 固定后被离开事件强制收起会让固定按钮形同虚设。 */ async () => {
    const { leave, models, wrapper } = mountSidebar(
      {},
      {},
      { collapse: false, expandOnHover: true, expandOnHovering: true },
    );

    await asideOf(wrapper).trigger('mouseleave');

    expect(leave).toHaveBeenCalledTimes(1);
    expect(models.collapse.value).toBe(false);
    expect(models.expandOnHovering.value).toBe(true);

    wrapper.unmount();
  });
});

describe('侧边栏混合菜单模式', /** 混合模式决定双列导航能否正确显示扩展面板。 */ () => {
  it('渲染扩展面板与全部插槽', /** 扩展面板缺失会让混合菜单的第二列整体消失。 */ () => {
    const { wrapper } = mountSidebar(
      { isSidebarMixed: true },
      {
        /** 主菜单插槽：承载第一列导航。 */
        default: /** 渲染主菜单内容。 */ () =>
          h('div', { class: 'probe-menu' }, 'DUMMY-主菜单'),
        /** 扩展区插槽：承载第二列导航。 */
        extra: /** 渲染扩展区内容。 */ () =>
          h('div', { class: 'probe-extra' }, 'DUMMY-扩展菜单'),
        /** 扩展区标题插槽：承载第二列分组标题。 */
        'extra-title': /** 渲染扩展区标题。 */ () =>
          h('div', { class: 'probe-extra-title' }, 'DUMMY-扩展标题'),
      },
    );

    const aside = asideOf(wrapper);
    expect(aside.classes()).toContain('bg-sidebar-deep');
    expect(aside.classes()).not.toContain('border-r');
    expect(wrapper.get('.probe-extra').text()).toBe('DUMMY-扩展菜单');
    expect(wrapper.get('.probe-extra-title').text()).toBe('DUMMY-扩展标题');
    // 混合模式的主列不再渲染折叠按钮，避免与扩展面板的折叠入口冲突。
    expect(wrapper.findComponent(SidebarCollapseButton).exists()).toBe(false);
    expect(wrapper.findComponent(SidebarFixedButton).exists()).toBe(true);

    wrapper.unmount();
  });

  it('扩展面板按可见状态渲染宽度与左侧偏移', /** 偏移算错会让扩展面板压住主列或飘离侧栏。 */ () => {
    const { wrapper } = mountSidebar(
      { isSidebarMixed: true },
      {},
      { extraVisible: true },
    );

    const panel = extraPanelOf(wrapper);
    expect(panel.className).toContain('border-l');
    expect(panel.style.left).toBe('210px');
    expect(panel.style.width).toBe('200px');

    wrapper.unmount();
  });

  it('扩展面板收起时不再显示左侧边框', /** 收起仍显示边框会在主列右侧留下一条竖线。 */ () => {
    const { wrapper } = mountSidebar({ isSidebarMixed: true });

    const panel = extraPanelOf(wrapper);
    expect(panel.className).not.toContain('border-l');
    expect(panel.style.left).toBe('210px');
    expect(panel.style.width).not.toBe('200px');

    wrapper.unmount();
  });

  it('扩展面板折叠时隐藏标题与固定按钮', /** 折叠后仍渲染标题会与菜单重叠。 */ () => {
    const { wrapper } = mountSidebar(
      { isSidebarMixed: true },
      {
        /** 扩展区标题插槽：承载第二列分组标题。 */
        'extra-title': /** 渲染扩展区标题。 */ () =>
          h('div', { class: 'probe-extra-title' }, 'DUMMY-扩展标题'),
      },
      { extraCollapse: true },
    );

    expect(wrapper.find('.probe-extra-title').exists()).toBe(false);
    expect(wrapper.findComponent(SidebarFixedButton).exists()).toBe(false);
    // 折叠只影响标题与按钮，扩展区菜单本身必须保留。
    expect(wrapper.findAllComponents(VbenScrollbar).length).toBe(2);

    wrapper.unmount();
  });

  it('扩展面板的固定按钮切换悬浮展开', /** 扩展面板固定入口失效会让第二列无法锁定展开。 */ async () => {
    const { models, wrapper } = mountSidebar({ isSidebarMixed: true });

    await wrapper.findComponent(SidebarFixedButton).trigger('click');

    expect(models.expandOnHover.value).toBe(true);
    // 固定后扩展面板才渲染自身的折叠入口。
    expect(wrapper.findAllComponents(SidebarCollapseButton).length).toBe(1);

    wrapper.unmount();
  });

  it('悬浮展开时扩展面板的折叠按钮驱动自身折叠', /** 扩展面板折叠入口失效会让第二列无法收起。 */ async () => {
    const { models, wrapper } = mountSidebar(
      { isSidebarMixed: true },
      {},
      { expandOnHover: true },
    );

    const buttons = wrapper.findAllComponents(SidebarCollapseButton);
    expect(buttons.length).toBe(1);
    await buttons[0]?.trigger('click');

    expect(models.extraCollapse.value).toBe(true);

    wrapper.unmount();
  });

  it('固定扩展区时强制显示扩展面板', /** 固定扩展区却仍收起会让固定配置失效。 */ async () => {
    const { models, wrapper } = mountSidebar({
      fixedExtra: true,
      isSidebarMixed: true,
    });
    await nextTick();

    expect(models.extraVisible.value).toBe(true);
    expect(extraPanelOf(wrapper).style.width).toBe('200px');

    wrapper.unmount();
  });

  it('混合且固定扩展区时内容宽度按折叠状态取混合宽度', /** 宽度取错会让折叠态与展开态的主列宽度互换。 */ () => {
    const expanded = mountSidebar({
      collapseWidth: 48,
      fixedExtra: true,
      isSidebarMixed: true,
      mixedWidth: 80,
    });
    expect(
      expanded.wrapper.findAllComponents(VbenScrollbar)[0]?.element.style.width,
    ).toBe('80px');
    expanded.wrapper.unmount();

    const collapsed = mountSidebar(
      {
        collapseWidth: 48,
        fixedExtra: true,
        isSidebarMixed: true,
        mixedWidth: 80,
      },
      {},
      { collapse: true },
    );
    expect(
      collapsed.wrapper.findAllComponents(VbenScrollbar)[0]?.element.style
        .width,
    ).toBe('48px');
    collapsed.wrapper.unmount();
  });

  it('扩展面板可见时关闭过渡动画', /** 固定扩展区时仍播放过渡会让面板每次渲染都闪动。 */ () => {
    const { wrapper } = mountSidebar(
      { isSidebarMixed: true },
      {},
      { extraVisible: true },
    );

    expect(asideOf(wrapper).element.style.transition).toBe('none');

    wrapper.unmount();
  });

  it('扩展面板不可见时保留过渡动画', /** 负对照：非固定扩展区必须保留过渡，否则展开会生硬跳变。 */ () => {
    const { wrapper } = mountSidebar({ isSidebarMixed: true });

    expect(asideOf(wrapper).element.style.transition).toBe('');

    wrapper.unmount();
  });
});

describe('侧边栏混合模式滚动锁定', /** 悬浮展开混合菜单时需要锁住页面滚动，否则滚动会带走面板。 */ () => {
  it('鼠标进入锁住页面滚动，离开解锁', /** 不锁滚动会让混合菜单在滚动时错位，不解锁会让整页无法滚动。 */ async () => {
    const { wrapper } = mountSidebar({ isSidebarMixed: true });

    await asideOf(wrapper).trigger('mouseenter', { offsetX: 20 });
    expect(document.body.style.overflow).toBe('hidden');

    await asideOf(wrapper).trigger('mouseleave');
    expect(document.body.style.overflow).not.toBe('hidden');

    wrapper.unmount();
  });
});
