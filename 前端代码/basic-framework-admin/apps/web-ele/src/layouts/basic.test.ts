/**
 * 管理平台基础布局（layouts/basic）真实行为回归。
 *
 * 该布局组合基础布局、用户下拉与锁屏组件，并把三件事交给框架：用户菜单的跳转入口、水印
 * 配置随偏好设置的启停、以及任何一处退出动作都走同一条登出链路。菜单处理器写错会让"个人
 * 中心"点不动；头像取值漏掉默认头像会让未设置头像的用户显示破图；水印监听漏掉内容兜底会
 * 让水印显示成 `undefined - undefined`；关闭水印时未销毁会让上一份水印残留在页面上；
 * 三处退出入口漏接会让用户无法退出登录。用例挂载真实布局组件与真实 Pinia 用户 Store，
 * 只把重型布局容器、水印第三方实现、路由跳转与认证 Store 替换成可观察替身。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { preferences, preferencesManager } from '@vben/preferences';
import { useUserStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Basic from './basic.vue';

/** 用户下拉菜单项契约：文案与点击处理器。 */
interface UserMenuItem {
  /** 点击菜单项时执行的处理器。 */
  handler?: () => unknown;
  /** 菜单项展示文案。 */
  text?: string;
}

/** 外部边界替身：路由跳转、登出、水印 API 与图标。 */
const spies = vi.hoisted(
  /** 建立用例可断言的外部边界替身。 */ () => ({
    destroyWatermark: vi.fn(),
    logout: vi.fn(),
    push: vi.fn(),
    updateWatermark: vi.fn(),
  }),
);

vi.mock(
  '#/router',
  /** 路由是外部边界，只记录跳转目标。 */ () => ({
    router: { push: spies.push },
  }),
);

vi.mock(
  '#/store',
  /** 认证 Store 的登出会发起真实请求，这里只记录调用参数。 */ () => ({
    /** 返回可观察的认证 Store 替身。 */
    useAuthStore: () => ({ logout: spies.logout }),
  }),
);

vi.mock(
  '@vben/hooks',
  /** 保留其余组合式函数，只把第三方水印实现换成可观察替身。 */ async (
    importOriginal,
  ) => {
    const original = await importOriginal<Record<string, unknown>>();
    return {
      ...original,
      /** 返回记录调用的水印 API，真实水印 DOM 不属于本用例范围。 */
      useWatermark: () => ({
        destroyWatermark: spies.destroyWatermark,
        updateWatermark: spies.updateWatermark,
      }),
    };
  },
);

vi.mock(
  '@vben/icons',
  /** 图标是纯展示边界，替换成最小可识别组件。 */ () => ({
    AntdProfileOutlined: { name: 'AntdProfileOutlined', template: '<i />' },
  }),
);

vi.mock(
  '#/locales',
  /** 固定语言包，使断言只依赖键名而不依赖具体翻译内容。 */ () => ({
    /** 返回键名，便于核对组件请求了哪些文案键。 */
    $t: (key: string) => key,
  }),
);

vi.mock(
  '@vben/layouts',
  /** 只替换重型布局容器，布局自身的菜单、头像与退出契约保持真实实现。 */ () => {
    /**
     * 基础布局替身：渲染两个插槽并提供触发整体退出的入口。
     */
    const BasicLayoutStub = defineComponent({
      name: 'BasicLayoutStub',
      emits: ['clear-preferences-and-logout'],
      /**
       * 渲染用户下拉与锁屏插槽。
       * @param _props 布局替身未声明属性。
       * @param context 组件上下文，用于取用插槽与派发事件。
       * @param context.emit 派发退出事件。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染函数。
       */
      setup(_props, { emit, slots }) {
        return /** 渲染插槽并提供整体退出按钮。 */ () =>
          h('div', { class: 'basic-layout-stub' }, [
            h(
              'button',
              {
                class: 'logout-trigger',
                /** 点击后派发整体退出事件。 */
                onClick: () => emit('clear-preferences-and-logout'),
              },
              '退出',
            ),
            slots['user-dropdown']?.(),
            slots['lock-screen']?.(),
          ]);
      },
    });
    /** 用户下拉替身：暴露全部属性、渲染菜单项并提供退出入口。 */
    const UserDropdownStub = defineComponent({
      name: 'UserDropdownStub',
      props: {
        /** 头像地址。 */
        avatar: { default: '', type: String },
        /** 菜单项列表，元素带 text 与 handler。 */
        menus: { /** 默认无菜单项。 */ default: () => [], type: Array },
        /** 昵称。 */
        text: { default: '', type: String },
        /** 邮箱。 */
        description: { default: '', type: String },
        /** 账号名标签。 */
        tagText: { default: '', type: String },
      },
      emits: ['logout'],
      /**
       * 渲染菜单项与退出按钮，使用例能驱动真实处理器。
       * @param props 用户下拉替身声明的属性。
       * @param context 组件上下文，用于派发退出事件。
       * @param context.emit 派发退出事件。
       * @returns 渲染函数。
       */
      setup(props, { emit }) {
        return /** 渲染菜单项与退出按钮。 */ () =>
          h('div', { class: 'user-dropdown-stub' }, [
            ...(props.menus as UserMenuItem[]).map(
              /**
               * 为每个菜单项渲染可点击入口。
               * @param item 用户下拉的菜单项。
               * @param index 菜单项下标，用于生成稳定选择器。
               */
              (item, index: number) =>
                h(
                  'button',
                  {
                    class: `menu-item-${index}`,
                    /** 点击后执行菜单项自身的处理器。 */
                    onClick: () => item.handler?.(),
                  },
                  item.text,
                ),
            ),
            h(
              'button',
              {
                class: 'dropdown-logout',
                /** 点击后派发下拉退出事件。 */
                onClick: () => emit('logout'),
              },
              '退出',
            ),
          ]);
      },
    });
    /** 锁屏替身：暴露头像属性并提供回登录入口。 */
    const LockScreenStub = defineComponent({
      name: 'LockScreenStub',
      props: {
        /** 头像地址。 */
        avatar: { default: '', type: String },
      },
      emits: ['to-login'],
      /**
       * 渲染回登录入口，使用例能驱动真实退出链路。
       * @param _props 锁屏替身声明的属性。
       * @param context 组件上下文，用于派发事件。
       * @param context.emit 派发回登录事件。
       * @returns 渲染函数。
       */
      setup(_props, { emit }) {
        return /** 渲染回登录按钮。 */ () =>
          h(
            'button',
            {
              class: 'lock-screen-login',
              /** 点击后派发回登录事件。 */
              onClick: () => emit('to-login'),
            },
            '回登录',
          );
      },
    });
    return {
      BasicLayout: BasicLayoutStub,
      LockScreen: LockScreenStub,
      UserDropdown: UserDropdownStub,
    };
  },
);

beforeEach(
  /** 每例使用独立 Pinia、清空替身并复位偏好设置，避免用例互相污染。 */ () => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    preferencesManager.resetPreferences();
  },
);

afterEach(
  /** 还原偏好设置，避免水印开关泄漏到其他用例。 */ () => {
    preferencesManager.resetPreferences();
  },
);

/**
 * 写入一份字段完整的当前用户身份。
 * @param overrides 用例需要覆盖的身份字段。
 */
function setCurrentUser(overrides: Record<string, unknown> = {}) {
  useUserStore().setUserInfo({
    avatar: 'https://files.test/avatar.png',
    email: 'tester@example.test',
    id: 7,
    nickname: '测试员',
    userId: 'U7',
    username: 'tester',
    ...overrides,
  } as never);
}

describe('基础布局用户菜单', /** 菜单处理器与文案决定用户能否从右上角进入个人中心。 */ () => {
  it('渲染个人中心菜单并跳转到 Profile 路由', /** 处理器写错会让"个人中心"点不动，用户只能手改地址栏。 */ async () => {
    setCurrentUser();
    const wrapper = mount(Basic);

    const item = wrapper.get('.menu-item-0');
    expect(item.text()).toBe('ui.widgets.profile');

    await item.trigger('click');

    expect(spies.push).toHaveBeenCalledWith({ name: 'Profile' });
  });

  it('把当前身份的头像、昵称、邮箱与账号名交给用户下拉', /** 漏传身份字段会让右上角显示空白的用户名与破图头像。 */ () => {
    setCurrentUser();
    const wrapper = mount(Basic);

    const dropdown = wrapper.getComponent({ name: 'UserDropdownStub' });
    expect(dropdown.props('avatar')).toBe('https://files.test/avatar.png');
    expect(dropdown.props('text')).toBe('测试员');
    expect(dropdown.props('description')).toBe('tester@example.test');
    expect(dropdown.props('tagText')).toBe('tester');
    expect(dropdown.props('menus')).toHaveLength(1);
  });

  it('未加载身份时头像回退到偏好设置里的默认头像', /** 头像兜底丢失会让未设置头像的用户看到破图。 */ () => {
    const wrapper = mount(Basic);

    const dropdown = wrapper.getComponent({ name: 'UserDropdownStub' });
    expect(dropdown.props('avatar')).toBe(preferences.app.defaultAvatar);
  });
});

describe('基础布局退出入口', /** 三处退出入口必须走同一条登出链路，漏接会让用户无法退出登录。 */ () => {
  it('整体退出事件触发认证 Store 登出且不带强制提示', /** 退出必须真正调用登出，否则前端看起来已退出但令牌仍然有效。 */ async () => {
    const wrapper = mount(Basic);

    await wrapper.get('.logout-trigger').trigger('click');

    expect(spies.logout).toHaveBeenCalledWith(false);
  });

  it('用户下拉的退出事件触发同一条登出链路', /** 下拉里的退出是用户最常用的入口，漏接会让菜单形同装饰。 */ async () => {
    const wrapper = mount(Basic);

    await wrapper.get('.dropdown-logout').trigger('click');

    expect(spies.logout).toHaveBeenCalledWith(false);
  });

  it('锁屏中的回登录事件触发同一条登出链路', /** 锁屏回登录必须清除会话，否则会回到仍带旧令牌的登录页。 */ async () => {
    const wrapper = mount(Basic);

    await wrapper.get('.lock-screen-login').trigger('click');

    expect(spies.logout).toHaveBeenCalledWith(false);
  });
});

describe('基础布局水印监听', /** 水印随偏好设置启停，配置错误会让敏感页面缺失或残留水印。 */ () => {
  it('开启水印且配置了内容时按配置内容更新水印', /** 配置内容被忽略会让用户设置的警示文案失效。 */ async () => {
    preferencesManager.updatePreferences({
      app: { watermark: true, watermarkContent: '内部资料 禁止外传' },
    });

    mount(Basic);
    await vi.waitFor(
      /** 等待立即执行的监听落地。 */ () => {
        expect(spies.updateWatermark).toHaveBeenCalledWith({
          content: '内部资料 禁止外传',
        });
      },
    );
  });

  it('未配置内容时用用户编号与昵称兜底', /** 兜底缺失会让水印显示成 undefined - undefined，失去追溯意义。 */ async () => {
    setCurrentUser();
    preferencesManager.updatePreferences({
      app: { watermark: true, watermarkContent: '' },
    });

    mount(Basic);
    await vi.waitFor(
      /** 等待立即执行的监听落地。 */ () => {
        expect(spies.updateWatermark).toHaveBeenCalledWith({
          content: '7 - 测试员',
        });
      },
    );
  });

  it('关闭水印时销毁已有水印', /** 只停止更新而不销毁会让上一份水印永久残留在页面上。 */ async () => {
    preferencesManager.updatePreferences({
      app: { watermark: true, watermarkContent: '先开启' },
    });
    mount(Basic);

    preferencesManager.updatePreferences({ app: { watermark: false } });

    await vi.waitFor(
      /** 等待监听响应偏好变化。 */ () => {
        expect(spies.destroyWatermark).toHaveBeenCalled();
      },
    );
  });
});
