/**
 * 面包屑导航（widgets/breadcrumb.vue）真实路由层级渲染回归。
 *
 * 面包屑按当前路由的 matched 记录逐层渲染层级，并承担“回到上层”的跳转：层级漏渲染会让用户
 * 看不到自己在系统中的位置，标题取错会显示成键名，点击跳转写错会把用户带到错误的页面。
 * 用例在真实 vue-router（内存历史）上挂载组件，用真实路由表与真实语言包断言渲染层级、标题、
 * 首页项、单层隐藏规则与点击后的真实跳转结果。
 *
 * 层级图标由远程图标集供应，属外部边界，用例只断言图标名确实下发给条目，不等待远程图标到位。
 */
import type { RouteRecordRaw } from 'vue-router';

import { mount } from '@vue/test-utils';
import { createApp, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { setupI18n } from '@vben/locales';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import Breadcrumb from './breadcrumb.vue';

/** 路由视图占位：用例只关心面包屑层级，视图本身不参与渲染。 */
const pageView = {
  /** 渲染空节点。 */
  render: () => null,
};

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

/**
 * 构造真实路由表，覆盖多层嵌套、隐藏项、菜单内隐藏子级与无标题四种元信息。
 * @returns 可供内存路由使用的路由记录数组。
 */
function createRoutes(): RouteRecordRaw[] {
  return [
    {
      component: pageView,
      meta: { title: 'preferences.breadcrumb.home' },
      name: 'Root',
      path: '/',
    },
    {
      component: pageView,
      meta: {
        icon: 'lucide:settings',
        title: 'preferences.breadcrumb.title',
      },
      name: 'Dashboard',
      path: '/dashboard',
      children: [
        {
          component: pageView,
          meta: { icon: 'lucide:home', title: 'preferences.language' },
          name: 'Workplace',
          path: 'workplace',
          children: [
            {
              component: pageView,
              meta: { title: 'preferences.theme.light' },
              name: 'Analysis',
              path: 'analysis',
            },
          ],
        },
        {
          component: pageView,
          meta: {
            hideInBreadcrumb: true,
            title: 'preferences.breadcrumb.icon',
          },
          name: 'HiddenCrumb',
          path: 'hidden-crumb',
        },
      ],
    },
    {
      component: pageView,
      meta: {
        hideChildrenInMenu: true,
        title: 'preferences.breadcrumb.enable',
      },
      name: 'System',
      path: '/system',
      children: [
        {
          component: pageView,
          meta: { title: 'preferences.breadcrumb.home' },
          name: 'SystemChild',
          path: 'child',
        },
      ],
    },
    {
      component: pageView,
      name: 'NoTitle',
      path: '/no-title',
    },
  ];
}

/** 用例共享的真实路由实例。 */
let router: ReturnType<typeof createRouter>;

/** 用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

/**
 * 在指定真实路由上挂载面包屑。
 * @param path 需要先导航到的真实路由路径。
 * @param props 透传给面包屑的属性，如首页项与图标开关。
 * @returns 已挂载的面包屑宿主。
 */
async function mountAt(path: string, props: Record<string, unknown> = {}) {
  await router.push(path);
  await router.isReady();
  mounted = mount(Breadcrumb, {
    global: { plugins: [router] },
    props,
  });
  return mounted;
}

/**
 * 读取真实渲染的面包屑条目文案。
 * @param wrapper 已挂载的面包屑宿主。
 * @returns 按渲染顺序排列的条目文案数组，不含分隔符。
 */
function crumbTexts(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('li.inline-flex')
    .map(
      /** 取每个条目的可见文案并去掉首尾空白。 */ (item) => item.text().trim(),
    );
}

beforeAll(
  /** 按真实 API 装载中文语言包，层级标题取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

beforeEach(
  /** 每例建立独立内存路由，避免上一例的导航历史影响层级判定。 */ async () => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: createRoutes(),
    });
  },
);

afterEach(
  /** 卸载宿主，避免残留的响应式副作用影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

describe('面包屑层级渲染', /** 层级与标题写错会让用户看不出当前位置。 */ () => {
  it('按真实路由逐层渲染标题且末层不可点击', /** 层级漏渲染或末层仍可点击都会误导用户。 */ async () => {
    const wrapper = await mountAt('/dashboard/workplace/analysis');

    expect(crumbTexts(wrapper)).toEqual(['面包屑导航', '语言', '浅色']);
    // 前两层是可点击链接，末层用当前页语义渲染。
    const links = wrapper.findAll('a');
    expect(links).toHaveLength(2);
    expect(links[0]?.text().trim()).toBe('面包屑导航');
    expect(links[1]?.text().trim()).toBe('语言');
    expect(
      wrapper
        .findAll('span')
        .map(/** 读取当前页条目的真实文案。 */ (item) => item.text().trim()),
    ).toContain('浅色');
  });

  it('标题缺失时条目仍然渲染且文案为空', /** 条目缺失会让面包屑层数与路由层级不一致。 */ async () => {
    const wrapper = await mountAt('/no-title');

    const items = wrapper.findAll('li.inline-flex');
    expect(items).toHaveLength(1);
    // 路由没有标题时该层仍占位，但不会退化成显示路由名或键名。
    expect(items[0]?.text().trim()).toBe('');
    expect(wrapper.text()).not.toContain('NoTitle');
  });

  it('showIcon 打开时每个带图标的层级渲染真实图标', /** 图标开关失效会让面包屑丢掉层级标识。 */ async () => {
    const wrapper = await mountAt('/dashboard/workplace', { showIcon: true });

    const icons = wrapper.findAll('.iconify');
    expect(icons).toHaveLength(2);
    expect(icons[0]?.classes()).toContain('iconify--lucide');
    expect(icons[1]?.classes()).toContain('iconify--lucide');
  });

  it('showIcon 关闭时不渲染层级图标', /** 图标关不掉会让用户无法使用纯文字面包屑。 */ async () => {
    const wrapper = await mountAt('/dashboard/workplace');

    expect(wrapper.findAll('.iconify')).toHaveLength(0);
  });
});

describe('面包屑隐藏规则', /** 隐藏规则判错会让不该出现的层级进入面包屑。 */ () => {
  it('hideInBreadcrumb 命中的层级被跳过', /** 规则失效会把标记隐藏的页面暴露在面包屑里。 */ async () => {
    const wrapper = await mountAt('/dashboard/hidden-crumb');

    expect(crumbTexts(wrapper)).toEqual(['面包屑导航']);
    expect(wrapper.text()).not.toContain('显示面包屑图标');
  });

  it('hideChildrenInMenu 命中的父级被跳过而子级保留', /** 规则失效会渲染出菜单里并不存在的父级层级。 */ async () => {
    const wrapper = await mountAt('/system/child');

    expect(crumbTexts(wrapper)).toEqual(['显示首页按钮']);
    expect(wrapper.text()).not.toContain('开启面包屑导航');
  });
});

describe('面包屑首页项与单层隐藏', /** 首页项与单层隐藏决定面包屑是否有多余内容。 */ () => {
  it('showHome 打开时最前面追加纯图标首页项', /** 首页项缺失会让用户无法从面包屑回到首页。 */ async () => {
    const wrapper = await mountAt('/dashboard/workplace', { showHome: true });

    const items = wrapper.findAll('li.inline-flex');
    expect(items).toHaveLength(3);
    // 首页项没有标题，只靠图标标识，因此文案为空。
    expect(items[0]?.text().trim()).toBe('');
    expect(crumbTexts(wrapper)[1]).toBe('面包屑导航');
    expect(crumbTexts(wrapper)[2]).toBe('语言');
  });

  it('hideWhenOnlyOne 打开且只有一层时整体隐藏', /** 单层仍渲染会让页面出现只有一个条目的面包屑。 */ async () => {
    const wrapper = await mountAt('/no-title', { hideWhenOnlyOne: true });

    expect(crumbTexts(wrapper)).toEqual([]);
  });

  it('hideWhenOnlyOne 打开但存在首页项时仍渲染', /** 多出首页项后总数超过一层，隐藏判定必须按补足后的数量计算。 */ async () => {
    const wrapper = await mountAt('/no-title', {
      hideWhenOnlyOne: true,
      showHome: true,
    });

    expect(crumbTexts(wrapper)).toEqual(['', '']);
    expect(wrapper.findAll('li.inline-flex')).toHaveLength(2);
  });
});

describe('面包屑跳转', /** 跳转写错会把用户带到错误页面。 */ () => {
  it('点击上层条目跳转到该层真实路径', /** 跳转参数取错会让用户回不到上层菜单。 */ async () => {
    const wrapper = await mountAt('/dashboard/workplace/analysis');
    const upperLink = wrapper.findAll('a')[0]?.element as HTMLElement;

    upperLink.click();
    await vi.waitFor(
      /** 等待真实导航完成后再断言落点路径。 */ () => {
        expect(router.currentRoute.value.path).toBe('/dashboard');
      },
      { timeout: 2000 },
    );
  });

  it('点击首页项跳转到根路径', /** 首页项路径写错会把用户带到不存在的地址。 */ async () => {
    const wrapper = await mountAt('/dashboard/workplace', { showHome: true });
    const homeLink = wrapper.findAll('a')[0]?.element as HTMLElement;

    homeLink.click();
    await vi.waitFor(
      /** 等待真实导航完成后再断言落到站点根路径。 */ () => {
        expect(router.currentRoute.value.path).toBe('/');
      },
      { timeout: 2000 },
    );
  });
});
