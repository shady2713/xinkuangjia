/**
 * Tippy 初始化与包装函数的真实行为回归。
 *
 * 该模块是全局提示能力的装配入口：`initTippy` 必须把默认属性真实写入 tippy、注册
 * `v-tippy` 指令，并在使用方未固定主题时随明暗模式刷新主题；`Tippy` 包装函数必须
 * 合并 props 与透传属性、把 `auto`/`dark` 归一化成 tippy 能识别的主题值并透传插槽。
 * 用例只把 tippy 渲染边界替换成受控替身，主题归一化与偏好订阅逻辑全部真实执行。
 */
import type { ObjectDirective, SetupContext } from 'vue';

import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { setDefaultProps } from 'vue-tippy';

import { preferencesManager } from '@vben-core/preferences';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTippy, Tippy } from './index';

vi.mock(
  'vue-tippy',
  /** 只替换第三方提示渲染边界：记录默认属性写入并提供可断言的最小组件。 */ async () => {
    const { defineComponent, h } = await import('vue');
    return {
      /** 承接包装函数返回的 vnode，保留透传属性与插槽供断言。 */
      Tippy: defineComponent({
        name: 'TippyStub',
        inheritAttrs: false,
        /**
         * 渲染最小提示节点并保留真实透传属性与插槽。
         * @param _ 未使用的组件属性。
         * @param context 组件上下文，提供透传属性与插槽。
         * @returns 渲染替换组件的渲染函数。
         */
        setup(_, { attrs, slots }) {
          return /** 渲染最小提示节点并保留真实透传属性。 */ () =>
            h(
              'div',
              { 'data-test': 'tippy-stub', ...attrs },
              slots.default?.(),
            );
        },
      }),
      setDefaultProps: vi.fn(),
      useTippy: vi.fn(),
    };
  },
);

/**
 * 创建只用于注册指令的应用实例。
 * @returns 可安装指令的空应用。
 */
function createProbeApp() {
  return createApp(
    defineComponent({
      name: 'ProbeRoot',
      /** 渲染空节点，仅提供真实应用上下文。 */
      render: () => null,
    }),
  );
}

/**
 * 构造包装函数所需的透传属性与插槽上下文。
 * @param attrs 本次要透传的属性。
 * @returns 与真实 SetupContext 结构一致的最小上下文。
 */
function createContext(attrs: Record<string, unknown>) {
  return {
    attrs,
    slots: {
      /** 渲染插槽内容，验证插槽真实透传。 */
      default: () => h('span', { 'data-test': 'slot' }, '提示内容'),
    },
  } as unknown as SetupContext;
}

describe('tippy 初始化', /** 全局默认属性与主题跟随写错会让所有提示显示错误主题。 */ () => {
  beforeEach(
    /** 每个用例从默认偏好与清空的调用记录出发。 */ () => {
      preferencesManager.resetPreferences();
      vi.mocked(setDefaultProps).mockClear();
    },
  );

  afterEach(
    /** 恢复被用例改写的偏好，避免影响其他用例。 */ () => {
      preferencesManager.resetPreferences();
    },
  );

  it('未固定主题时写入默认属性、注册指令并立刻跟随当前主题', /** 未注册指令则模板里的 v-tippy 完全不生效；主题不归一化会退回 tippy 默认样式。 */ () => {
    const app = createProbeApp();
    preferencesManager.updatePreferences({ theme: { mode: 'light' } });

    initTippy(app);

    expect(setDefaultProps).toHaveBeenNthCalledWith(1, {
      allowHTML: true,
      delay: [500, 200],
      theme: 'light',
    });
    // 未传 options 时必须注册跟随主题的副作用，并在创建时立即执行一次。
    expect(setDefaultProps).toHaveBeenNthCalledWith(2, { theme: 'light' });

    const directive = app.directive('tippy') as ObjectDirective | undefined;
    expect(directive).toBeDefined();
    expect(typeof directive?.mounted).toBe('function');
    expect(typeof directive?.unmounted).toBe('function');
  });

  it('使用方固定 theme 后不再跟随明暗模式', /** 显式固定主题的调用方不能被全局主题切换覆盖。 */ async () => {
    const app = createProbeApp();

    initTippy(app, { theme: 'light' });

    expect(setDefaultProps).toHaveBeenCalledTimes(1);
    expect(setDefaultProps).toHaveBeenLastCalledWith({
      allowHTML: true,
      delay: [500, 200],
      theme: 'light',
    });

    preferencesManager.updatePreferences({ theme: { mode: 'dark' } });
    await nextTick();

    expect(setDefaultProps).toHaveBeenCalledTimes(1);
  });

  it('theme 为 auto 时随明暗模式刷新真实默认主题', /** auto 必须落成 tippy 可识别的取值，且深色切换要即时生效。 */ async () => {
    const app = createProbeApp();
    preferencesManager.updatePreferences({ theme: { mode: 'light' } });

    initTippy(app, { theme: 'auto' });

    expect(setDefaultProps).toHaveBeenNthCalledWith(1, {
      allowHTML: true,
      delay: [500, 200],
      theme: 'auto',
    });
    expect(setDefaultProps).toHaveBeenNthCalledWith(2, { theme: 'light' });

    preferencesManager.updatePreferences({ theme: { mode: 'dark' } });
    await nextTick();

    expect(setDefaultProps).toHaveBeenLastCalledWith({ theme: '' });
  });
});

describe('tippy 包装函数', /** 包装函数决定提示文案、主题与插槽能否真实落地。 */ () => {
  beforeEach(
    /** 每个用例从默认偏好出发。 */ () => {
      preferencesManager.resetPreferences();
    },
  );

  afterEach(
    /** 恢复被用例改写的偏好。 */ () => {
      preferencesManager.resetPreferences();
    },
  );

  it('合并 props 与透传属性并把 auto 归一化为当前主题', /** auto 直接交给 tippy 会得到无样式提示。 */ () => {
    preferencesManager.updatePreferences({ theme: { mode: 'light' } });

    const vnode = Tippy(
      { title: '来自 props 的标题' },
      createContext({ 'data-x': '1', theme: 'auto' }),
    );

    expect(vnode.props).toMatchObject({
      'data-x': '1',
      theme: 'light',
      title: '来自 props 的标题',
    });
  });

  it('深色模式下 auto 与 dark 归一化为空主题、light 保持不变', /** 深色主题在 tippy 侧用空串表示，显式 light 仍必须保持浅色。 */ () => {
    preferencesManager.updatePreferences({ theme: { mode: 'dark' } });

    expect(Tippy({}, createContext({ theme: 'auto' })).props?.theme).toBe('');
    expect(Tippy({}, createContext({ theme: 'dark' })).props?.theme).toBe('');
    expect(Tippy({}, createContext({ theme: 'light' })).props?.theme).toBe(
      'light',
    );
  });

  it('未传 theme 时按当前主题取值', /** 业务组件普遍不声明 theme，缺省必须跟随全局模式。 */ () => {
    preferencesManager.updatePreferences({ theme: { mode: 'dark' } });
    expect(Tippy({}, createContext({})).props?.theme).toBe('');

    preferencesManager.updatePreferences({ theme: { mode: 'light' } });
    expect(Tippy({}, createContext({})).props?.theme).toBe('light');
  });

  it('返回的 vnode 真实渲染出透传属性与插槽', /** 只断言 vnode 结构不足以证明渲染结果，必须挂载一次。 */ () => {
    preferencesManager.updatePreferences({ theme: { mode: 'light' } });
    const vnode = Tippy({}, createContext({ 'data-x': '1' }));
    const Host = defineComponent({
      name: 'TippyVNodeHost',
      /** 渲染包装函数产出的真实 vnode。 */
      render: () => vnode,
    });

    const wrapper = mount(Host);

    expect(wrapper.get('[data-test="tippy-stub"]').attributes('data-x')).toBe(
      '1',
    );
    expect(wrapper.text()).toContain('提示内容');
    expect(vnode.props).toMatchObject({ theme: 'light' });
  });
});
