/**
 * 应用启动编排（apps/web-ele 的 bootstrap）真实行为回归。
 *
 * bootstrap 负责在渲染前完成组件适配器与表单初始化，按固定顺序安装插件、注册全局指令、
 * 初始化国际化与状态库，最后挂载应用，并让页面标题跟随路由与偏好动态更新。
 * 顺序写错会让页面在适配器未就绪时渲染、指令未注册就报错、偏好未初始化就读取标题。
 * 用例使用真实 `createApp` 与真实挂载流程，只替换各外部边界并记录真实调用顺序。
 */
import type { App } from 'vue';

import { nextTick } from 'vue';

import { preferences } from '@vben/preferences';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrap } from './bootstrap';

/** 启动编排各外部边界的调用顺序，用于断言真实先后关系。 */
const order = vi.hoisted(
  /** 建立跨用例共享的调用顺序记录。 */ () => [] as string[],
);

/** 各外部边界的记录型替身；用例按需设置返回值并断言调用参数。 */
const spies = vi.hoisted(
  /** 建立可断言的外部边界替身。 */ () => ({
    initComponentAdapter: vi.fn(),
    initSetupVbenForm: vi.fn(),
    initStores: vi.fn(),
    initTippy: vi.fn(),
    registerAccessDirective: vi.fn(),
    registerLoadingDirective: vi.fn(),
    setupFormCreate: vi.fn(),
    setupI18n: vi.fn(),
    useTitle: vi.fn(),
  }),
);

vi.mock(
  './adapter/component',
  /** 只替换组件适配器初始化边界，启动顺序保持真实。 */ () => ({
    /** 记录适配器初始化时机。 */
    initComponentAdapter: spies.initComponentAdapter,
  }),
);

vi.mock(
  './adapter/form',
  /** 只替换表单初始化边界，启动顺序保持真实。 */ () => ({
    /** 记录表单初始化时机。 */
    initSetupVbenForm: spies.initSetupVbenForm,
  }),
);

vi.mock(
  './app.vue',
  /** 只替换应用根组件，挂载流程本身保持真实。 */ async () => {
    const { defineComponent, h } = await import('vue');
    const AppStub = defineComponent({
      name: 'AppStub',
      /**
       * 渲染可定位的根节点。
       * @returns 渲染根节点的渲染函数。
       */
      setup() {
        return /** 输出可定位节点并记录渲染时机。 */ () => {
          order.push('renderApp');
          return h('div', { 'data-test': 'app-root' }, '已挂载');
        };
      },
    });
    return { default: AppStub };
  },
);

vi.mock(
  './router',
  /** 只替换路由插件，启动编排对路由的安装与标题读取保持真实。 */ async () => {
    const { ref } = await import('vue');
    return {
      router: {
        install: vi.fn(
          /** 记录路由安装时机。 */ () => {
            order.push('useRouter');
          },
        ),
        currentRoute: ref({ meta: { title: '工作台' } }),
      },
    };
  },
);

vi.mock(
  '#/locales',
  /** 只替换国际化初始化与文案函数，启动编排的调用时机保持真实。 */ () => ({
    /** 回显语言键，使断言不依赖真实语言包。 */
    $t: (key: string) => `译文:${key}`,
    /** 记录国际化初始化时机。 */
    setupI18n: spies.setupI18n,
  }),
);

vi.mock(
  '#/plugins/form-create',
  /** 只替换表单设计器插件，启动编排的调用时机保持真实。 */ () => ({
    /** 记录表单设计器安装时机。 */
    setupFormCreate: spies.setupFormCreate,
  }),
);

vi.mock(
  '@vben/access',
  /** 只替换权限指令注册边界，启动编排的调用时机保持真实。 */ () => ({
    /** 记录权限指令注册时机。 */
    registerAccessDirective: spies.registerAccessDirective,
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换加载指令注册边界，启动编排传入的开关参数保持真实。 */ () => ({
    /** 记录加载指令注册时机。 */
    registerLoadingDirective: spies.registerLoadingDirective,
  }),
);

vi.mock(
  '@vben/common-ui/es/tippy',
  /** 只替换气泡提示初始化边界，动态导入时机保持真实。 */ () => ({
    /** 记录气泡提示初始化时机。 */
    initTippy: spies.initTippy,
  }),
);

vi.mock(
  '@vben/plugins/motion',
  /** 只替换动画插件，启动编排的安装时机保持真实。 */ () => ({
    MotionPlugin: {
      install: vi.fn(
        /** 记录动画插件安装时机。 */ () => {
          order.push('useMotion');
        },
      ),
    },
  }),
);

vi.mock(
  '@vben/preferences',
  /** 只替换偏好状态，标题的读取与响应式更新保持真实。 */ async () => {
    const { reactive } = await import('vue');
    return {
      preferences: reactive({
        app: { dynamicTitle: true, name: '测试平台' },
      }),
    };
  },
);

vi.mock(
  '@vben/stores',
  /** 只替换状态库初始化边界，命名空间参数与调用时机保持真实。 */ () => ({
    /** 记录状态库初始化时机。 */
    initStores: spies.initStores,
  }),
);

vi.mock(
  '@vben/styles',
  /** 样式入口与启动编排无关，避免测试进程加载样式预处理链。 */ () => ({}),
);

vi.mock(
  '@vben/styles/ele',
  /** Element Plus 样式入口与启动编排无关，避免测试进程加载样式预处理链。 */ () => ({}),
);

vi.mock(
  'element-plus',
  /** 只替换 Element Plus 的加载指令定义，指令注册调用保持真实。 */ () => ({
    ElLoading: { directive: { name: 'el-loading-directive' } },
  }),
);

vi.mock(
  'vue-dompurify-html',
  /** 只替换 HTML 净化插件，启动编排的安装时机保持真实。 */ () => ({
    default: {
      install: vi.fn(
        /** 记录净化插件安装时机。 */ () => {
          order.push('useDomPurify');
        },
      ),
    },
  }),
);

vi.mock(
  '@vueuse/core',
  /** 只替换标题写入边界，标题文案的组装保持真实。 */ () => ({
    /** 记录标题写入内容。 */
    useTitle: spies.useTitle,
  }),
);

/** 启动编排创建的 Vue 应用实例；由 initStores 替身捕获，供用例断言与清理。 */
let mountedApp: App | undefined;

spies.initComponentAdapter.mockImplementation(
  /** 记录适配器初始化顺序。 */ async () => {
    order.push('initComponentAdapter');
  },
);
spies.initSetupVbenForm.mockImplementation(
  /** 记录表单初始化顺序。 */ async () => {
    order.push('initSetupVbenForm');
  },
);
spies.setupI18n.mockImplementation(
  /** 记录国际化初始化顺序。 */ async () => {
    order.push('setupI18n');
  },
);
spies.initStores.mockImplementation(
  /**
   * 记录状态库初始化顺序并捕获真实应用实例。
   * @param app 启动编排创建的应用实例。
   */
  async (app: App) => {
    order.push('initStores');
    mountedApp = app;
  },
);
spies.registerAccessDirective.mockImplementation(
  /** 记录权限指令注册顺序。 */ () => {
    order.push('registerAccessDirective');
  },
);
spies.registerLoadingDirective.mockImplementation(
  /** 记录加载指令注册顺序。 */ () => {
    order.push('registerLoadingDirective');
  },
);
spies.initTippy.mockImplementation(
  /** 记录气泡提示初始化顺序。 */ () => {
    order.push('initTippy');
  },
);
spies.setupFormCreate.mockImplementation(
  /** 记录表单设计器安装顺序。 */ () => {
    order.push('setupFormCreate');
  },
);
spies.useTitle.mockImplementation(
  /** 记录标题写入顺序。 */ () => {
    order.push('useTitle');
  },
);

beforeEach(
  /**
   * 建立应用挂载点并复位记录，保证每例从同一状态开始。
   * `watchEffect` 不属于应用实例的作用域，卸载应用不会停止它，因此先把动态标题关掉并等待
   * 残留侦听器结算，再清空调用记录，避免上一例的标题写入污染本例计数。
   */ async () => {
    preferences.app.dynamicTitle = false;
    await nextTick();
    vi.clearAllMocks();
    order.length = 0;
    mountedApp = undefined;
    const root = document.createElement('div');
    root.id = 'app';
    document.body.append(root);
  },
);

afterEach(
  /**
   * 卸载应用并清理挂载点，避免残留实例的标题副作用影响后续用例。
   * 这里不调用 `vi.restoreAllMocks`：替身的实现由本文件在模块级统一装配，
   * 恢复默认实现会让后续用例失去外部边界的记录能力。
   */
  () => {
    mountedApp?.unmount();
    mountedApp = undefined;
    document.body.innerHTML = '';
  },
);

describe('启动编排顺序', /** 顺序决定页面渲染前各能力是否已就绪，写错会在运行时直接报错。 */ () => {
  it('按适配器、插件、国际化、状态库、指令与挂载的顺序启动', /** 顺序颠倒会让页面在适配器或状态库未就绪时渲染。 */ async () => {
    preferences.app.dynamicTitle = true;

    await bootstrap('bootstrap-test');

    expect(order).toEqual([
      'initComponentAdapter',
      'initSetupVbenForm',
      'useDomPurify',
      'registerLoadingDirective',
      'setupI18n',
      'initStores',
      'registerAccessDirective',
      'initTippy',
      'useRouter',
      'useMotion',
      'setupFormCreate',
      'useTitle',
      'renderApp',
    ]);
    // 真实挂载：根组件内容必须出现在挂载点内，而不是只创建了应用实例。
    expect(
      document.querySelector('#app [data-test="app-root"]')?.textContent,
    ).toBe('已挂载');
  });

  it('状态库使用调用方传入的命名空间', /** 命名空间写死会让不同环境的本地缓存互相覆盖。 */ async () => {
    await bootstrap('another-namespace');

    expect(spies.initStores).toHaveBeenCalledWith(expect.anything(), {
      namespace: 'another-namespace',
    });
  });

  it('把 Element Plus 的加载指令注册为 loading', /** 指令名写错会让业务页面的 v-loading 无法解析。 */ async () => {
    await bootstrap('bootstrap-test');

    const directives = (
      mountedApp as unknown as {
        _context: { directives: Record<string, unknown> };
      }
    )._context.directives;
    expect(directives.loading).toMatchObject({
      name: 'el-loading-directive',
    });
  });

  it('按约定参数注册加载与旋转指令', /** 参数写错会让业务方无法使用 v-loading 或与 Element Plus 的指令冲突。 */ async () => {
    await bootstrap('bootstrap-test');

    expect(spies.registerLoadingDirective).toHaveBeenCalledWith(
      expect.anything(),
      { loading: false, spinning: 'spinning' },
    );
  });

  it('国际化、权限指令、气泡提示与表单设计器都拿到同一个应用实例', /** 传错实例会让插件装到别处，页面行为与配置不一致。 */ async () => {
    await bootstrap('bootstrap-test');

    const app = mountedApp;
    expect(app).toBeDefined();
    expect(spies.setupI18n).toHaveBeenCalledWith(app);
    expect(spies.registerAccessDirective).toHaveBeenCalledWith(app);
    expect(spies.initTippy).toHaveBeenCalledWith(app);
    expect(spies.setupFormCreate).toHaveBeenCalledWith(app);
    expect(spies.initComponentAdapter).toHaveBeenCalledTimes(1);
    expect(spies.initSetupVbenForm).toHaveBeenCalledTimes(1);
  });
});

describe('动态标题', /** 标题跟随路由与偏好，写错会让所有页面显示同一个名字或缺少站点名。 */ () => {
  it('开启动态标题时按路由标题拼接站点名', /** 缺少路由标题前缀会让用户无法从标题分辨当前页面。 */ async () => {
    const { router } = await import('./router');
    router.currentRoute.value = { meta: { title: '工作台' } } as never;
    preferences.app.dynamicTitle = true;

    await bootstrap('bootstrap-test');

    expect(spies.useTitle).toHaveBeenCalledWith('译文:工作台 - 测试平台');
  });

  it('路由没有标题时只写站点名', /** 缺少站点名会让浏览器标签页无法识别系统。 */ async () => {
    const { router } = await import('./router');
    router.currentRoute.value = { meta: {} } as never;
    preferences.app.dynamicTitle = true;

    await bootstrap('bootstrap-test');

    expect(spies.useTitle).toHaveBeenCalledWith('测试平台');
  });

  it('关闭动态标题时不写入标题', /** 负对照：关闭开关后仍写标题会覆盖业务自己设置的标题。 */ async () => {
    preferences.app.dynamicTitle = false;

    await bootstrap('bootstrap-test');

    expect(spies.useTitle).not.toHaveBeenCalled();
  });

  it('偏好变化后标题跟随更新', /** 非响应式读取会让运行时切换动态标题不生效。 */ async () => {
    const { router } = await import('./router');
    router.currentRoute.value = { meta: { title: '工作台' } } as never;
    preferences.app.dynamicTitle = false;
    await bootstrap('bootstrap-test');
    expect(spies.useTitle).not.toHaveBeenCalled();

    preferences.app.dynamicTitle = true;
    await nextTick();

    expect(spies.useTitle).toHaveBeenCalledWith('译文:工作台 - 测试平台');
  });
});
