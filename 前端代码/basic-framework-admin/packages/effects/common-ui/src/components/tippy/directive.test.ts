/**
 * tippy 指令（effects/common-ui 的 tippy/directive）在真实 Vue 指令管线上的行为回归。
 *
 * `v-tippy` 是页面提示的统一入口：绑定值解析错会把配置对象当成提示文案，修饰符未落到配置上
 * 会让声明的位置与箭头失效，`title`/`content` 属性未迁移会让浏览器原生提示与 tippy 提示同时
 * 出现，生命周期回调未转发会让业务收不到 tippy 事件，卸载与更新未处理实例会让提示泄漏或
 * 主题不跟随明暗模式。用例在真实 Vue 指令管线上挂载元素，只把第三方提示引擎替换成记录创建
 * 参数并暴露 destroy/setProps 的替身，指令自身的取值归一化、属性迁移与回调转发全部真实执行。
 */
import type { Directive } from 'vue';

import { mount } from '@vue/test-utils';
import {
  computed,
  defineComponent,
  h,
  nextTick,
  ref,
  withDirectives,
} from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useTippyDirective from './directive';

/** 第三方提示引擎替身记录：模块替身与用例读取同一实例。 */
const tippyProbe = vi.hoisted(
  /** 建立可逐例重置的创建记录、实例记录与挂载位置开关。 */ () => ({
    /** 是否创建实例；关闭时用于验证缺少实例的容错路径。 */
    createInstance: true,
    /** 每次 useTippy 的元素与配置记录。 */
    created: [] as { el: HTMLElement; opts: Record<string, unknown> }[],
    /** 已创建实例的记录，顺序与 created 一致。 */
    instances: [] as {
      /** 销毁提示实例。 */
      destroy: ReturnType<typeof vi.fn>;
      /** 更新提示实例配置。 */
      setProps: ReturnType<typeof vi.fn>;
    }[],
    /** 实例挂载位置：dollar 写 $tippy，underscore 写 _tippy。 */
    placement: 'underscore' as 'dollar' | 'underscore',
  }),
);

vi.mock(
  'vue-tippy',
  /** 只替换第三方提示渲染与实例管理，指令自身的配置组装与钩子转发保持真实。 */ () => ({
    /**
     * 记录创建参数并把可控实例挂到元素上。
     * @param el 指令作用的 DOM 元素。
     * @param opts 指令组装出的提示配置。
     * @returns 记录用的提示实例。
     */
    useTippy: (el: HTMLElement, opts: Record<string, unknown>) => {
      tippyProbe.created.push({ el, opts });
      const instance = {
        destroy: vi.fn(),
        setProps: vi.fn(),
      };
      if (tippyProbe.createInstance) {
        if (tippyProbe.placement === 'dollar') {
          (el as HTMLElement & { $tippy?: unknown }).$tippy = instance;
        } else {
          (el as HTMLElement & { _tippy?: unknown })._tippy = instance;
        }
      }
      tippyProbe.instances.push(instance);
      return instance;
    },
  }),
);

/** tippy 生命周期回调签名：参数原样转发给元素上声明的处理函数。 */
type TippyListener = (...args: unknown[]) => void;

/** 指令挂载用例的输入。 */
interface MountOptions {
  /** 元素上的原生属性，用于验证 title/content 迁移。 */
  attributes?: Record<string, string>;
  /** 元素上声明的 tippy 生命周期回调。 */
  listeners?: Record<string, TippyListener>;
  /** 指令修饰符，例如 `{ arrow: true, top: true }`。 */
  modifiers?: Record<string, boolean>;
  /** 指令绑定值：字符串内容或完整配置对象。 */
  value: unknown;
}

/**
 * 在真实 Vue 指令管线上挂载一次 v-tippy。
 * @param options 绑定值、修饰符、元素属性与回调声明。
 * @returns 已挂载的包装器、真实元素与可驱动重渲染的状态。
 */
function mountDirective(options: MountOptions) {
  const dark = ref(false);
  const tick = ref(0);
  const value = ref(options.value);
  const directive: Directive = useTippyDirective(
    computed(/** 读取当前深色模式，驱动主题刷新。 */ () => dark.value),
  );
  const Host = defineComponent({
    name: 'TippyDirectiveHost',
    /**
     * 渲染带指令的元素；读取 tick 以便用例强制触发一次真实重渲染。
     * @returns 带 v-tippy 指令的元素节点。
     */
    setup() {
      return /** 渲染带指令的元素并在每次重渲染时读取 tick。 */ () => {
        void tick.value;
        return withDirectives(
          h('div', {
            'data-test': 'target',
            ...options.attributes,
            ...options.listeners,
          }),
          [[directive, value.value, undefined, options.modifiers ?? {}]],
        );
      };
    },
  });
  const wrapper = mount(Host);
  return {
    /** 深色模式开关，用于驱动主题刷新。 */
    dark,
    /** 真实 DOM 元素。 */
    el: wrapper.get('[data-test="target"]').element as HTMLElement,
    /** 强制重渲染，触发指令的 updated 钩子。 */
    async rerender() {
      tick.value += 1;
      await nextTick();
      await nextTick();
    },
    /** 指令绑定值，用于验证更新路径。 */
    value,
    /** 已挂载的组件包装器。 */
    wrapper,
  };
}

/**
 * 读取最近一次创建的提示配置。
 * @returns 指令交给第三方引擎的配置对象。
 * @throws Error 没有创建记录时抛出，避免用例静默通过。
 */
function latestOpts() {
  const last = tippyProbe.created.at(-1);
  if (!last) {
    throw new Error('指令未创建提示实例');
  }
  return last.opts;
}

/**
 * 读取最近一次创建的提示实例。
 * @returns 第三方引擎返回并被指令使用的实例。
 * @throws Error 没有实例记录时抛出，避免用例静默通过。
 */
function latestInstance() {
  const last = tippyProbe.instances.at(-1);
  if (!last) {
    throw new Error('指令未创建提示实例');
  }
  return last;
}

beforeEach(
  /** 每例从空的创建记录与默认挂载位置出发。 */ () => {
    tippyProbe.created = [];
    tippyProbe.instances = [];
    tippyProbe.createInstance = true;
    tippyProbe.placement = 'underscore';
  },
);

afterEach(
  /** 还原被替换的全局状态，避免影响其他用例。 */ () => {
    vi.restoreAllMocks();
  },
);

describe('挂载时的配置组装', /** 挂载决定提示内容与位置，配置组装错会直接体现在页面上。 */ () => {
  it('字符串绑定值作为提示内容创建实例', /** 字符串写法是最常用入口，解析错会让提示显示为空。 */ () => {
    const { el } = mountDirective({ value: '提示内容' });

    expect(tippyProbe.created).toHaveLength(1);
    expect(tippyProbe.created[0]?.el).toBe(el);
    expect(latestOpts()).toEqual({ content: '提示内容' });
  });

  it('对象绑定值原样作为配置并叠加修饰符', /** 配置对象被复制或改写会让业务声明的提示参数丢失。 */ () => {
    const config = { content: '配置内容' };
    mountDirective({ modifiers: { arrow: true, top: true }, value: config });

    // 真实实现直接使用绑定对象，修饰符也写回同一对象（响应式代理写入仍落到原对象）。
    expect(latestOpts()).toEqual({
      arrow: true,
      content: '配置内容',
      placement: 'top',
    });
    expect(config).toEqual({
      arrow: true,
      content: '配置内容',
      placement: 'top',
    });
  });

  it('配置已声明的位置与箭头优先于修饰符', /** 修饰符覆盖显式配置会让业务无法固定提示方向。 */ () => {
    const config = { arrow: false, content: '配置内容', placement: 'bottom' };
    mountDirective({ modifiers: { arrow: true, top: true }, value: config });

    expect(config.placement).toBe('bottom');
    expect(config.arrow).toBe(false);
  });

  it('未声明绑定值时使用空配置', /** 只写指令不传值时不能抛错，提示应按默认行为工作。 */ () => {
    mountDirective({ value: undefined });

    expect(latestOpts()).toEqual({});
  });
});

describe('title 与 content 属性迁移', /** 属性不迁移会让浏览器原生提示与 tippy 提示同时出现。 */ () => {
  it('title 属性迁移为提示内容并从元素移除', /** 保留 title 会让浏览器弹出第二套提示。 */ () => {
    const { el } = mountDirective({
      attributes: { title: '标题提示' },
      value: undefined,
    });

    expect(latestOpts().content).toBe('标题提示');
    expect(el.getAttribute('title')).toBeNull();
  });

  it('content 属性迁移为提示内容且保留原属性', /** content 不是浏览器原生提示来源，删除会破坏业务读取。 */ () => {
    const { el } = mountDirective({
      attributes: { content: '内容属性' },
      value: undefined,
    });

    expect(latestOpts().content).toBe('内容属性');
    expect(el.getAttribute('content')).toBe('内容属性');
  });

  it('已声明内容时不使用元素属性', /** 显式内容被属性覆盖会让业务文案失效。 */ () => {
    const { el } = mountDirective({
      attributes: { content: '内容属性', title: '标题提示' },
      value: '显式内容',
    });

    expect(latestOpts().content).toBe('显式内容');
    expect(el.getAttribute('title')).toBe('标题提示');
  });
});

describe('生命周期回调转发', /** 业务通过元素回调接入 tippy 事件，不转发会让埋点与联动失效。 */ () => {
  it('把五类 tippy 回调转发到元素声明的处理函数', /** 任一回调漏转发都会让业务收不到对应的提示事件。 */ () => {
    const handlers = {
      onTippyHidden: vi.fn(),
      onTippyHide: vi.fn(),
      onTippyMount: vi.fn(),
      onTippyShow: vi.fn(),
      onTippyShown: vi.fn(),
    };
    mountDirective({ listeners: handlers, value: '提示内容' });

    const opts = latestOpts() as Record<string, TippyListener>;
    opts.onShow?.('show', 1);
    opts.onShown?.('shown');
    opts.onHidden?.('hidden');
    opts.onHide?.('hide');
    opts.onMount?.('mount');

    expect(handlers.onTippyShow).toHaveBeenCalledWith('show', 1);
    expect(handlers.onTippyShown).toHaveBeenCalledWith('shown');
    expect(handlers.onTippyHidden).toHaveBeenCalledWith('hidden');
    expect(handlers.onTippyHide).toHaveBeenCalledWith('hide');
    expect(handlers.onTippyMount).toHaveBeenCalledWith('mount');
  });

  it('未声明回调时不写入对应配置', /** 凭空写入回调会让第三方引擎在错误时机调用空函数。 */ () => {
    mountDirective({ value: '提示内容' });

    const opts = latestOpts();
    expect(opts.onShow).toBeUndefined();
    expect(opts.onShown).toBeUndefined();
    expect(opts.onHidden).toBeUndefined();
    expect(opts.onHide).toBeUndefined();
    expect(opts.onMount).toBeUndefined();
  });
});

describe('卸载时的实例销毁', /** 不销毁实例会让提示节点与事件监听泄漏到页面之外。 */ () => {
  it('优先销毁 $tippy 实例', /** vue-tippy 暴露 $tippy 时必须走该实例，漏掉会留下悬挂提示。 */ () => {
    tippyProbe.placement = 'dollar';
    const { wrapper } = mountDirective({ value: '提示内容' });
    const instance = latestInstance();

    wrapper.unmount();

    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('没有 $tippy 时回退销毁 _tippy 实例', /** 只认一种实例属性会让另一种接入方式的提示泄漏。 */ () => {
    const { wrapper } = mountDirective({ value: '提示内容' });
    const instance = latestInstance();

    wrapper.unmount();

    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('缺少实例时不抛出异常', /** 创建失败时卸载不能反过来打断页面销毁流程。 */ () => {
    tippyProbe.createInstance = false;
    const { wrapper } = mountDirective({ value: '提示内容' });

    expect(/** 卸载带指令的组件。 */ () => wrapper.unmount()).not.toThrow();
  });
});

describe('更新时的主题与内容刷新', /** 明暗模式切换与绑定值变化必须刷新到已存在的提示实例上。 */ () => {
  it('字符串绑定值更新时刷新内容并带上浅色主题', /** 更新时不带主题会让深色页面出现浅色提示。 */ async () => {
    const { rerender, value } = mountDirective({ value: '初始内容' });
    const instance = latestInstance();

    value.value = '更新内容';
    await rerender();

    expect(instance.setProps).toHaveBeenCalledWith({
      content: '更新内容',
      theme: 'light',
    });
  });

  it('深色模式下主题归一化为空串', /** 深色主题在 tippy 侧用空串表示，写错会让提示样式与页面冲突。 */ async () => {
    const { dark, rerender } = mountDirective({ value: '初始内容' });
    const instance = latestInstance();

    dark.value = true;
    await rerender();

    expect(instance.setProps).toHaveBeenLastCalledWith({
      content: '初始内容',
      theme: '',
    });
  });

  it('对象绑定值更新时合并主题与配置', /** 配置对象更新时丢弃业务参数会让提示内容回退。 */ async () => {
    const { rerender, value } = mountDirective({ value: { content: '初始' } });
    const instance = latestInstance();

    value.value = { content: '更新' };
    await rerender();

    expect(instance.setProps).toHaveBeenLastCalledWith({
      content: '更新',
      theme: 'light',
    });
  });

  it('更新时迁移 title 属性并回退到 _tippy 实例', /** 更新路径漏迁移属性或漏认实例都会让提示与元素状态不一致。 */ async () => {
    const { el, rerender } = mountDirective({
      attributes: { title: '标题提示' },
      value: '',
    });
    const instance = latestInstance();
    // 首次挂载已迁移过 title，这里重新写回以验证更新路径同样会迁移。
    el.setAttribute('title', '标题提示');

    await rerender();

    expect(instance.setProps).toHaveBeenLastCalledWith({
      content: '标题提示',
      theme: 'light',
    });
    expect(el.getAttribute('title')).toBeNull();
  });

  it('更新时迁移 content 属性且保留原属性', /** content 属性在更新路径同样要参与内容解析，否则提示会退回空内容。 */ async () => {
    const { el, rerender } = mountDirective({
      attributes: { content: '内容属性' },
      value: '',
    });
    const instance = latestInstance();

    await rerender();

    expect(instance.setProps).toHaveBeenLastCalledWith({
      content: '内容属性',
      theme: 'light',
    });
    expect(el.getAttribute('content')).toBe('内容属性');
  });

  it('更新时优先使用 $tippy 实例', /** 只更新 _tippy 会让 vue-tippy 接入的提示停留在旧内容。 */ async () => {
    tippyProbe.placement = 'dollar';
    const { rerender } = mountDirective({ value: '初始内容' });
    const instance = latestInstance();

    await rerender();

    expect(instance.setProps).toHaveBeenCalledWith({
      content: '初始内容',
      theme: 'light',
    });
  });

  it('缺少实例时更新不抛出异常', /** 实例尚未建立时的重渲染不能打断页面更新。 */ async () => {
    tippyProbe.createInstance = false;
    const { rerender, value } = mountDirective({ value: '初始内容' });

    value.value = '更新内容';

    await expect(rerender()).resolves.toBeUndefined();
  });
});
