/**
 * 加载指令与旋转指令（components/loading/directive）真实行为回归。
 *
 * `registerLoadingDirective` 负责把 `v-loading` / `v-spinning` 装进应用并注入相对定位样式，
 * 两个指令在挂载时渲染真实的 VbenLoading/VbenSpinner、在绑定值变化时把新属性写进组件实例、
 * 在卸载时移除渲染结果与定位类。注册名写错会让业务页面取不到指令，更新分支写错会让
 * "加载中"状态无法切换，卸载分支漏清理会在元素上残留覆盖层与定位样式。
 * 用例使用真实的应用实例与真实的指令挂载流程，只对控制台报错与故障注入点做受控替换。
 */
import type { Directive, VNode } from 'vue';

import {
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
  resolveDirective,
  withDirectives,
} from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerLoadingDirective } from './directive';

/** 指令绑定值：undefined 表示按默认开启，布尔值直接控制开关，对象按属性透传。 */
type DirectiveValue = boolean | Record<string, unknown> | undefined;

/** 指令注入的相对定位类名，业务方依赖它让覆盖层相对容器定位。 */
const RELATIVE_CLASS = 'spinner-parent--relative';

/** 用例挂载应用的容器；每例独立创建并在结束时移除。 */
let container: HTMLDivElement;

/** loading 指令的绑定值；由宿主组件在 setup 中创建，供用例驱动 updated 钩子。 */
let loadingValue: ReturnType<typeof ref<DirectiveValue>> | undefined;

/** spinning 指令的绑定值；由宿主组件在 setup 中创建，供用例驱动 updated 钩子。 */
let spinningValue: ReturnType<typeof ref<DirectiveValue>> | undefined;

/**
 * 创建使用被测指令的宿主组件。
 * @param loadingName 已注册的 loading 指令名；省略时不渲染该目标元素。
 * @param spinningName 已注册的 spinning 指令名；省略时不渲染该目标元素。
 * @returns 在渲染函数中按当前绑定值挂载指令的宿主组件。
 */
function createHost(loadingName?: string, spinningName?: string) {
  /**
   * 按当前绑定值渲染两个指令目标元素。
   * @returns 承载 loading 与 spinning 目标元素的宿主节点。
   */
  function renderHost() {
    const children: VNode[] = [];
    if (loadingName) {
      children.push(
        withDirectives(h('div', { class: 'loading-target' }), [
          [resolveDirective(loadingName) as Directive, loadingValue?.value],
        ]),
      );
    }
    if (spinningName) {
      children.push(
        withDirectives(h('div', { class: 'spinning-target' }), [
          [resolveDirective(spinningName) as Directive, spinningValue?.value],
        ]),
      );
    }
    return h('div', { class: 'host' }, children);
  }

  return defineComponent({
    name: 'LoadingDirectiveHost',
    /**
     * 建立可被用例驱动的绑定值。
     * @returns 渲染函数；每次渲染都按当前绑定值重新挂载指令，使 updated 钩子可被驱动。
     */
    setup() {
      loadingValue = ref<DirectiveValue>(undefined);
      spinningValue = ref<DirectiveValue>(undefined);
      return renderHost;
    },
  });
}

/**
 * 读取指定目标元素内被指令渲染出来的组件实例属性。
 * @param target 承载指令的元素。
 * @returns 被渲染组件的 props；元素内没有组件实例时返回 undefined。
 */
function readRenderedProps(target: Element) {
  const rendered = target.firstElementChild as
    | (Element & { __vueParentComponent?: { props: Record<string, unknown> } })
    | null;
  return rendered?.__vueParentComponent?.props;
}

/**
 * 取出宿主组件创建的 loading 绑定值。
 * @returns 可被用例写入的 loading 绑定值引用。
 * @throws Error 宿主组件尚未挂载时抛出，避免用例静默地什么都不验证。
 */
function requireLoadingValue() {
  if (!loadingValue) {
    throw new Error('宿主组件未创建 loading 绑定值');
  }
  return loadingValue;
}

/**
 * 取出宿主组件创建的 spinning 绑定值。
 * @returns 可被用例写入的 spinning 绑定值引用。
 * @throws Error 宿主组件尚未挂载时抛出，避免用例静默地什么都不验证。
 */
function requireSpinningValue() {
  if (!spinningValue) {
    throw new Error('宿主组件未创建 spinning 绑定值');
  }
  return spinningValue;
}

/** 指令渲染出的组件内部实例视图；props 是指令 updated 钩子写入属性的真实目标。 */
type RenderedInstance = {
  props?: Record<string, unknown>;
};

/**
 * 读取指令渲染出的组件内部实例，用于受控故障注入。
 * @param target 承载指令的元素。
 * @returns 被渲染组件的内部实例视图。
 * @throws Error 元素内没有组件实例时抛出，避免用例静默地什么都不验证。
 */
function requireRenderedInstance(target: Element): RenderedInstance {
  const rendered = target.firstElementChild as
    | (Element & { __vueParentComponent?: RenderedInstance })
    | null;
  const internal = rendered?.__vueParentComponent;
  if (!internal) {
    throw new Error('指令未渲染出可注入故障的组件实例');
  }
  return internal;
}

/**
 * 等待加载组件的最小展示时间计时器结算。
 * @param milliseconds 等待毫秒数；默认覆盖 VbenLoading 的 50ms 最小展示时间。
 */
async function settleTimer(milliseconds = 80) {
  await new Promise(
    /** 用宏任务等待真实的 setTimeout 结算。 */ (resolve) => {
      setTimeout(resolve, milliseconds);
    },
  );
}

beforeEach(
  /** 建立独立挂载容器，隔离用例之间的 DOM。 */ () => {
    container = document.createElement('div');
    document.body.append(container);
  },
);

afterEach(
  /** 移除容器与指令注入的样式，恢复共享的 document 状态。 */ () => {
    container.remove();
    for (const style of document.querySelectorAll(`#${RELATIVE_CLASS}`)) {
      style.remove();
    }
    loadingValue = undefined;
    spinningValue = undefined;
    vi.restoreAllMocks();
  },
);

describe('指令注册', /** 注册名、注册开关与样式注入决定业务页面能否按预期使用指令。 */ () => {
  it('默认注册 loading 与 spinning 并注入相对定位样式', /** 少注册一个指令会让对应页面报指令未解析，缺少样式会让覆盖层铺满整页。 */ () => {
    const app = createApp(createHost('loading', 'spinning'));
    const register = vi.spyOn(app, 'directive');

    registerLoadingDirective(app);
    app.mount(container);

    expect(register).toHaveBeenCalledWith('loading', expect.any(Object));
    expect(register).toHaveBeenCalledWith('spinning', expect.any(Object));
    const style = document.head.querySelector(`#${RELATIVE_CLASS}`);
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain(
      `.${RELATIVE_CLASS} {\n      position: relative !important;\n    }`,
    );
    // 两个指令都真实渲染出各自的覆盖层组件，而不是只完成了注册。
    expect(container.querySelector('.loading-target')?.children).toHaveLength(
      1,
    );
    expect(container.querySelector('.spinning-target')?.children).toHaveLength(
      1,
    );
    expect(
      container
        .querySelector('.loading-target')
        ?.classList.contains(RELATIVE_CLASS),
    ).toBe(true);

    app.unmount();
  });

  it('可用自定义名称注册指令', /** 名称不可配置会让同一页面无法同时使用业务自己的 loading 指令。 */ () => {
    const app = createApp(createHost('v-loading', 'v-spinning'));
    const register = vi.spyOn(app, 'directive');

    registerLoadingDirective(app, {
      loading: 'v-loading',
      spinning: 'v-spinning',
    });
    app.mount(container);

    expect(register).toHaveBeenCalledWith('v-loading', expect.any(Object));
    expect(register).toHaveBeenCalledWith('v-spinning', expect.any(Object));
    expect(register).not.toHaveBeenCalledWith('loading', expect.any(Object));
    expect(container.querySelector('.loading-target')?.children).toHaveLength(
      1,
    );

    app.unmount();
  });

  it('按参数关闭单个指令的注册', /** 关闭开关失效会让业务方不得不注册多余的全局指令。 */ () => {
    const app = createApp(createHost(undefined, 'spinning'));
    const register = vi.spyOn(app, 'directive');

    registerLoadingDirective(app, { loading: false });
    app.mount(container);

    expect(register).not.toHaveBeenCalledWith('loading', expect.any(Object));
    expect(register).toHaveBeenCalledWith('spinning', expect.any(Object));
    expect(container.querySelector('.spinning-target')?.children).toHaveLength(
      1,
    );

    app.unmount();
  });

  it('两个开关都关闭时不注册任何指令', /** 参数全部关闭时仍注册会污染消费方的全局指令表。 */ () => {
    const app = createApp(createHost());
    const register = vi.spyOn(app, 'directive');

    registerLoadingDirective(app, { loading: false, spinning: false });
    app.mount(container);

    expect(register).not.toHaveBeenCalled();
    // 样式仍按约定注入，注册开关只影响指令本身。
    expect(document.head.querySelector(`#${RELATIVE_CLASS}`)).not.toBeNull();

    app.unmount();
  });
});

describe('指令挂载与更新', /** 挂载与更新分支决定覆盖层真实的显示内容与开关状态。 */ () => {
  it('绑定 undefined 时默认开启加载并渲染覆盖层', /** 默认值写错会让不带参数的 v-loading 反向关闭加载态。 */ async () => {
    const app = createApp(createHost('loading'));
    registerLoadingDirective(app);
    app.mount(container);

    const target = container.querySelector('.loading-target');
    expect(target?.classList.contains(RELATIVE_CLASS)).toBe(true);
    expect(readRenderedProps(target as Element)?.spinning).toBe(true);
    // 状态为真时覆盖层需要真实进入"渲染旋转图标"阶段，而不是只挂了空壳。
    await settleTimer();
    expect(target?.querySelector('.dot')).not.toBeNull();

    app.unmount();
  });

  it('布尔绑定值直接控制加载开关', /** 布尔值分支写错会让 :loading="false" 仍然显示加载中。 */ async () => {
    const app = createApp(createHost('loading', 'spinning'));
    registerLoadingDirective(app);
    app.mount(container);

    // 初始为 undefined，两个指令都按默认开启处理。
    expect(
      readRenderedProps(container.querySelector('.spinning-target') as Element)
        ?.spinning,
    ).toBe(true);

    requireLoadingValue().value = false;
    requireSpinningValue().value = false;
    await nextTick();

    expect(
      readRenderedProps(container.querySelector('.loading-target') as Element)
        ?.spinning,
    ).toBe(false);
    expect(
      readRenderedProps(container.querySelector('.spinning-target') as Element)
        ?.spinning,
    ).toBe(false);

    app.unmount();
  });

  it('对象绑定值把每个属性写进加载组件', /** 属性透传写错会让自定义文案、最小展示时间或样式类丢失。 */ async () => {
    const app = createApp(createHost('loading'));
    registerLoadingDirective(app);
    app.mount(container);

    requireLoadingValue().value = {
      class: 'directive-loading-updated',
      minLoadingTime: 0,
      spinning: true,
      text: '正在加载',
    };
    await nextTick();
    await settleTimer(5);

    const target = container.querySelector('.loading-target');
    const props = readRenderedProps(target as Element);
    expect(props?.text).toBe('正在加载');
    expect(props?.minLoadingTime).toBe(0);
    // class 必须真实落到渲染出的根节点上，才能被样式覆盖。
    expect(
      (target?.firstElementChild as Element).classList.contains(
        'directive-loading-updated',
      ),
    ).toBe(true);
    expect(target?.querySelector('.mt-4')?.textContent).toBe('正在加载');

    app.unmount();
  });

  it('对象绑定值把每个属性写进旋转组件', /** 旋转指令单独实现，属性透传写错会让遮罩样式失效。 */ async () => {
    const app = createApp(createHost(undefined, 'spinning'));
    registerLoadingDirective(app);
    app.mount(container);

    requireSpinningValue().value = {
      class: 'directive-spinning-updated',
      minLoadingTime: 0,
      spinning: true,
    };
    await nextTick();
    // 挂载时按默认 50ms 最小展示时间启动了计时器，等它结算后才能看到 loader。
    await settleTimer();

    const target = container.querySelector('.spinning-target');
    expect(readRenderedProps(target as Element)?.minLoadingTime).toBe(0);
    expect(
      (target?.firstElementChild as Element).classList.contains(
        'directive-spinning-updated',
      ),
    ).toBe(true);
    // 旋转组件在计时器结算后才渲染 loader，证明开关真实生效。
    expect(target?.querySelector('.loader')).not.toBeNull();

    // 关闭开关后 showSpinner 为假，此时过渡结束才会真正移除 loader。
    const root = target?.firstElementChild as HTMLElement;
    root.dispatchEvent(new Event('transitionend'));
    expect(target?.querySelector('.loader')).not.toBeNull();

    requireSpinningValue().value = { minLoadingTime: 0, spinning: false };
    await nextTick();
    root.dispatchEvent(new Event('transitionend'));
    await nextTick();
    expect(target?.querySelector('.loader')).toBeNull();

    app.unmount();
  });

  it('卸载时移除覆盖层与定位类', /** 漏清理会在元素上残留覆盖层，后续交互被遮挡。 */ () => {
    const app = createApp(createHost('loading', 'spinning'));
    registerLoadingDirective(app);
    app.mount(container);

    const loadingTarget = container.querySelector('.loading-target');
    const spinningTarget = container.querySelector('.spinning-target');
    expect(loadingTarget?.children).toHaveLength(1);

    app.unmount();

    expect(loadingTarget?.classList.contains(RELATIVE_CLASS)).toBe(false);
    expect(spinningTarget?.classList.contains(RELATIVE_CLASS)).toBe(false);
    expect(loadingTarget?.children).toHaveLength(0);
    expect(spinningTarget?.children).toHaveLength(0);
  });

  it('更新加载组件抛错时记录日志且不影响后续更新', /** 更新分支缺少兜底会让一次渲染异常直接中断业务方的状态切换。 */ async () => {
    const error = new Error('加载组件更新失败');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 静默控制台输出，避免污染测试日志。 */ () => {});
    const app = createApp(createHost('loading'));
    registerLoadingDirective(app);
    app.mount(container);

    const target = container.querySelector('.loading-target') as Element;
    // 受控故障注入：让组件属性写入抛错，验证指令的兜底日志分支。
    requireRenderedInstance(target).props = new Proxy(
      {},
      {
        /**
         * 属性写入即抛错，模拟组件更新失败。
         * @throws Error 受控故障注入，固定抛出本用例构造的更新失败错误。
         */
        set() {
          throw error;
        },
      },
    );

    requireLoadingValue().value = { class: 'after-error', spinning: true };
    await nextTick();

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to update loading component in directive:',
      error,
    );

    app.unmount();
  });

  it('更新旋转组件抛错时记录日志且不影响后续更新', /** 旋转指令的兜底分支与加载指令独立，必须单独验证。 */ async () => {
    const error = new Error('旋转组件更新失败');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 静默控制台输出，避免污染测试日志。 */ () => {});
    const app = createApp(createHost(undefined, 'spinning'));
    registerLoadingDirective(app);
    app.mount(container);

    const target = container.querySelector('.spinning-target') as Element;
    // 受控故障注入：让组件属性写入抛错，验证指令的兜底日志分支。
    requireRenderedInstance(target).props = new Proxy(
      {},
      {
        /**
         * 属性写入即抛错，模拟组件更新失败。
         * @throws Error 受控故障注入，固定抛出本用例构造的更新失败错误。
         */
        set() {
          throw error;
        },
      },
    );

    requireSpinningValue().value = { class: 'after-error', spinning: true };
    await nextTick();

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to update spinner component in directive:',
      error,
    );

    app.unmount();
  });
});
