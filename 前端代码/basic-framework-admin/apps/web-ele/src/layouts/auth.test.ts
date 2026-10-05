/**
 * 认证页布局（layouts/auth）真实行为回归。
 *
 * 该布局是登录、注册、找回密码等认证页的外壳：应用名、亮暗两套 logo 与页面标题都从运行时
 * 偏好设置与语言包取值后交给真实 `AuthPageLayout`。取值写死会让运维改配置后登录页仍显示
 * 旧品牌；漏传暗色 logo 会让暗色主题下的登录页出现白底图标；标题漏传会让浏览器页签丢失
 * 页面语义。用例挂载真实布局组件，只把重型布局容器替换成记录属性的替身并固定语言包，
 * 计算属性与偏好设置读取本身真实执行。
 */
import { mount } from '@vue/test-utils';

import { preferences, preferencesManager } from '@vben/preferences';

import { afterEach, describe, expect, it, vi } from 'vitest';

import Auth from './auth.vue';

/** 布局容器替身记录的属性；用例从同一实例读取，断言交给容器的真实契约。 */
const layoutProbe = vi.hoisted(
  /** 建立可读取属性的布局替身容器。 */ () => ({
    props: undefined as Record<string, unknown> | undefined,
  }),
);

vi.mock(
  '@vben/layouts',
  /** 只替换重型布局容器，认证页布局自身的取值与透传逻辑保持真实实现。 */ () => ({
    AuthPageLayout: {
      name: 'AuthPageLayoutStub',
      props: {
        /** 应用名，用于核对偏好设置取值。 */
        appName: { default: '', type: String },
        /** 亮色 logo 地址。 */
        logo: { default: '', type: String },
        /** 暗色 logo 地址。 */
        logoDark: { default: '', type: String },
        /** 页面描述文案。 */
        pageDescription: { default: '', type: String },
        /** 页面标题文案。 */
        pageTitle: { default: '', type: String },
      },
      /**
       * 记录收到的属性并渲染空节点，容器内部结构不属于本用例范围。
       * @param props 容器收到的属性快照。
       * @returns 渲染最小占位节点的渲染函数。
       */
      setup(props: Record<string, unknown>) {
        layoutProbe.props = props;
        return /** 渲染最小占位节点。 */ () => null;
      },
    },
  }),
);

vi.mock(
  '#/locales',
  /** 固定语言包，使断言只依赖键名而不依赖具体翻译内容。 */ () => ({
    /** 返回键名，便于核对组件请求了哪些文案键。 */
    $t: (key: string) => key,
  }),
);

afterEach(
  /** 还原偏好设置，避免用例之间互相污染。 */ () => {
    preferencesManager.resetPreferences();
  },
);

describe('认证页布局品牌取值', /** 品牌与标题来自运行时偏好设置，写死会让运维改配置后登录页仍显示旧品牌。 */ () => {
  it('把偏好设置中的应用名与亮暗 logo 交给布局容器', /** 漏传暗色 logo 会让暗色主题下的登录页出现白底图标。 */ () => {
    preferencesManager.updatePreferences({
      app: { name: 'DUMMY 管理平台' },
      logo: {
        source: 'https://files.test/logo.png',
        sourceDark: 'https://files.test/logo-dark.png',
      },
    });

    mount(Auth);

    expect(layoutProbe.props?.appName).toBe('DUMMY 管理平台');
    expect(layoutProbe.props?.logo).toBe('https://files.test/logo.png');
    expect(layoutProbe.props?.logoDark).toBe(
      'https://files.test/logo-dark.png',
    );
  });

  it('未配置 logo 时沿用框架默认品牌资源', /** 默认值是未配置品牌时的兜底，取值丢失会让登录页出现空图标。 */ () => {
    preferencesManager.resetPreferences();

    mount(Auth);

    expect(layoutProbe.props?.logo).toBe(preferences.logo.source);
    // 框架默认配置没有暗色 logo，组件必须原样透传缺省值，而不是编造一个地址。
    expect(layoutProbe.props?.logoDark).toBe('');
  });

  it('标题与描述使用认证页语言包键', /** 标题漏传会让浏览器页签丢失页面语义，用户无法区分多个打开的页签。 */ () => {
    mount(Auth);

    expect(layoutProbe.props?.pageTitle).toBe('authentication.pageTitle');
    expect(layoutProbe.props?.pageDescription).toBe('authentication.pageDesc');
  });

  it('偏好设置变化后重新计算品牌取值', /** 计算属性若缓存了首次取值，切换品牌配置后登录页不会更新。 */ async () => {
    preferencesManager.updatePreferences({ app: { name: '第一个品牌' } });
    const wrapper = mount(Auth);
    expect(layoutProbe.props?.appName).toBe('第一个品牌');

    preferencesManager.updatePreferences({ app: { name: '第二个品牌' } });
    await wrapper.vm.$nextTick();

    expect(layoutProbe.props?.appName).toBe('第二个品牌');
  });
});
