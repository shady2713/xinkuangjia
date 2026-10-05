/**
 * 面包屑（shadcn-ui 的 components/breadcrumb）层级渲染与选中回归。
 *
 * 面包屑展示当前页面的层级路径：末级必须是不可点击的当前页，中间层级点击后要抛出路径；
 * 带子菜单的层级要用下拉菜单列出同级的其它页面，点击子项同样要抛出路径；首页之后才出现分隔符；
 * 背景样式与普通样式必须按 styleType 切换。层级判定或事件载荷写错会让用户跳到错误页面。
 * 用例真实挂载三种面包屑组件并读取真实 DOM 结构与 select 事件载荷。
 */
import { mount } from '@vue/test-utils';
import { h } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import BreadcrumbBackground from './breadcrumb-background.vue';
import BreadcrumbView from './breadcrumb-view.vue';
import Breadcrumb from './breadcrumb.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载以清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

/** 层级图标夹具：用于核对 showIcon 时是否会渲染图标。 */
const ICON_STUB = () => h('i', { class: 'bc-icon' });

/** 面包屑夹具：首页、无路径的占位层级、带子菜单的中间层与末级当前页。 */
const BREADCRUMBS = [
  { icon: ICON_STUB, isHome: true, path: '/home', title: '首页' },
  { icon: ICON_STUB, title: '无路径层级' },
  {
    icon: ICON_STUB,
    items: [
      { path: '/system/user', title: '用户管理' },
      { path: '/system/role', title: '角色管理' },
    ],
    path: '/system',
    title: '系统管理',
  },
  { icon: ICON_STUB, path: '/system/dept', title: '部门管理' },
];

/**
 * 取出面包屑渲染出的带子菜单层级入口。
 * @param wrapper 已挂载的面包屑包装器。
 * @returns 命中的层级入口按钮包装器。
 * @throws Error 未渲染带子菜单的层级入口时抛出，避免用例静默地什么都不验证。
 */
function dropdownTriggerOf(wrapper: ReturnType<typeof mount>) {
  const trigger = wrapper
    .findAll('button')
    .find(
      /** 只挑出带下拉箭头的层级入口。 */ (button) =>
        button.text().includes('系统管理'),
    );
  if (!trigger) {
    throw new Error('面包屑未渲染带子菜单的层级入口');
  }
  return trigger;
}

/**
 * 取出已展开的下拉菜单中的层级子项。
 * @param title 子项文案。
 * @returns 命中的子菜单项元素。
 * @throws Error 子菜单项未渲染时抛出，避免用例静默地什么都不验证。
 */
function subMenuItem(title: string) {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    /** 只挑出文案匹配的子项。 */ (node) => node.textContent?.includes(title),
  );
  if (!item) {
    throw new Error('面包屑未渲染层级子菜单项');
  }
  return item as HTMLElement;
}

describe('普通面包屑层级渲染', /** 末级与中间层的判定决定用户可以点哪里。 */ () => {
  it('渲染首页、中间层与末级当前页', /** 末级渲染成链接会让用户点到当前页自身。 */ () => {
    mounted = mount(Breadcrumb, { props: { breadcrumbs: BREADCRUMBS } });

    expect(mounted.find('nav').attributes('aria-label')).toBe('breadcrumb');
    expect(mounted.find('ol').exists()).toBe(true);
    // 四个层级项 + 首页之后两个非末级层级的分隔符；首页与末级都不带分隔符。
    expect(mounted.findAll('li')).toHaveLength(6);
    const text = mounted.text();
    expect(text).toContain('首页');
    expect(text).toContain('系统管理');
    expect(text).toContain('部门管理');
    // 末级渲染成不可点击的当前页。
    expect(mounted.find('[aria-current="page"]').text()).toContain('部门管理');
  });

  it('点击中间层抛出该层路径', /** 载荷取错字段会让用户跳到错误页面。 */ async () => {
    mounted = mount(Breadcrumb, { props: { breadcrumbs: BREADCRUMBS } });

    await mounted.find('a[href="javascript:void 0"]').trigger('click');

    expect(mounted.emitted('select')?.[0]).toEqual(['/home']);
  });

  it('带子菜单的层级渲染下拉入口并可选择同级页面', /** 缺少子菜单入口会让同级页面无法直达。 */ async () => {
    mounted = mount(Breadcrumb, { props: { breadcrumbs: BREADCRUMBS } });

    const dropdownTrigger = dropdownTriggerOf(mounted);
    await dropdownTrigger.trigger('pointerdown', { button: 0 });
    await dropdownTrigger.trigger('click');
    await dropdownTrigger.trigger('keydown', { key: 'ArrowDown' });
    await new Promise(
      /** 等待下拉菜单真实展开。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    subMenuItem('用户管理').click();
    await new Promise(
      /** 等待点击事件真实派发完成。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(mounted.emitted('select')?.at(-1)).toEqual(['/system/user']);
  });

  it('showIcon 时渲染层级图标', /** 图标未渲染会让面包屑缺少视觉提示。 */ () => {
    mounted = mount(Breadcrumb, {
      props: { breadcrumbs: BREADCRUMBS, showIcon: true },
    });

    expect(mounted.findAll('.bc-icon')).toHaveLength(4);
  });

  it('点击无路径层级不抛出事件', /** 抛出空路径会让调用方跳到 undefined。 */ async () => {
    mounted = mount(Breadcrumb, { props: { breadcrumbs: BREADCRUMBS } });

    const links = mounted.findAll('a[href="javascript:void 0"]');
    await links[1]?.trigger('click');

    expect(mounted.emitted('select')).toBeUndefined();
  });
});

describe('背景样式面包屑', /** 背景样式用于顶栏，层级与点击语义必须一致。 */ () => {
  it('渲染列表并标记末级为当前项', /** 末级未标记会让当前页看似可点击。 */ () => {
    mounted = mount(BreadcrumbBackground, {
      props: { breadcrumbs: BREADCRUMBS },
    });

    expect(mounted.element.tagName).toBe('UL');
    const links = mounted.findAll('a');
    expect(links).toHaveLength(4);
    expect(links[3]?.find('span > span').classes()).toContain('font-normal');
  });

  it('点击非末级抛出路径，点击末级不抛出', /** 末级仍抛出会让用户跳到当前页自身。 */ async () => {
    mounted = mount(BreadcrumbBackground, {
      props: { breadcrumbs: BREADCRUMBS },
    });
    const links = mounted.findAll('a');

    await links[0]?.trigger('click');
    expect(mounted.emitted('select')?.[0]).toEqual(['/home']);

    await links[3]?.trigger('click');
    expect(mounted.emitted('select')).toHaveLength(1);
  });

  it('showIcon 时渲染层级图标', /** 图标未渲染会让背景面包屑缺少视觉提示。 */ () => {
    mounted = mount(BreadcrumbBackground, {
      props: { breadcrumbs: BREADCRUMBS, showIcon: true },
    });

    expect(mounted.findAll('.bc-icon')).toHaveLength(4);
  });
});

describe('面包屑视图样式切换', /** styleType 决定渲染普通还是背景样式。 */ () => {
  it('普通样式渲染导航容器', /** 样式类型写错会让顶栏与内容区用错面包屑。 */ () => {
    mounted = mount(BreadcrumbView, {
      props: { breadcrumbs: BREADCRUMBS, styleType: 'normal' },
    });

    expect(mounted.find('nav').exists()).toBe(true);
    expect(mounted.find('.vben-breadcrumb').exists()).toBe(true);
    expect(mounted.find('ul.flex').exists()).toBe(false);
  });

  it('背景样式渲染列表容器', /** 背景样式未切换会让面包屑与顶栏背景冲突。 */ () => {
    mounted = mount(BreadcrumbView, {
      props: { breadcrumbs: BREADCRUMBS, styleType: 'background' },
    });

    expect(mounted.find('ul.flex').exists()).toBe(true);
    expect(mounted.find('nav').exists()).toBe(false);
  });

  it('向上抛出层级选中事件', /** 未透传事件会让调用方收不到跳转请求。 */ async () => {
    mounted = mount(BreadcrumbView, {
      props: { breadcrumbs: BREADCRUMBS, styleType: 'normal' },
    });

    await mounted.find('a[href="javascript:void 0"]').trigger('click');

    expect(mounted.emitted('select')?.[0]).toEqual(['/home']);
  });
});
