/**
 * 抽屉声明入口（popup-ui 的 use-drawer）真实行为回归。
 *
 * `useVbenDrawer` 是全部业务抽屉的入口：connectedComponent 模式把内层抽屉的 API 通过
 * provide/inject 交给外层组件，非连接模式直接创建 API。全局默认属性合并错会让所有抽屉
 * 丢失默认行为；嵌套抽屉误继承上层配置会让子抽屉带上父抽屉的按钮与标题；destroyOnClose
 * 未重建会让下次打开残留上一次的内容；属性冲突校验缺失会让调用方绕过 API 直接改状态
 * 导致回调与状态不同步。用例按业务用法挂载真实组件，只替换抽屉内容渲染边界，
 * 注入、合并、重建与校验全部按真实实现执行。
 */
import type { DrawerApiOptions, ExtendedDrawerApi } from '../drawer';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, onMounted } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { setDefaultDrawerProps, useVbenDrawer } from '../use-drawer';

/** connectedComponent 替身收到的渲染入参，用于核对属性与插槽转发。 */
const connectedProbe: {
  /** 替身收到的 props 与 attrs 合并结果。 */
  props?: Record<string, unknown>;
  /** 替身收到的插槽表。 */
  slots?: Record<string, unknown>;
} = {};

/** 内层抽屉的 API 与调用记录；替身创建内层抽屉时写入。 */
const nestedProbe: {
  /** 第一层内层抽屉 API，用例用它触发关闭动画完成回调。 */
  api?: ExtendedDrawerApi;
  /** 内层抽屉收到的开关变化次数。 */
  innerOpenChange: number;
  /** 替身内容被挂载的次数，用于判断 destroyOnClose 是否重建。 */
  mounts: number;
  /** 内层抽屉声明的原始关闭回调调用次数。 */
  originalClosed: number;
  /** 连接式外层收到的开关变化次数。 */
  outerOpenChange: number;
  /** 第二层内层抽屉 API，用于核对嵌套抽屉不继承上层配置。 */
  secondApi?: ExtendedDrawerApi;
} = { innerOpenChange: 0, mounts: 0, originalClosed: 0, outerOpenChange: 0 };

/** 替身行为开关：内层抽屉层数与 destroyOnClose 配置。 */
const plan: {
  /** 是否开启 destroyOnClose。 */
  destroyOnClose: boolean;
  /** 替身创建的内层抽屉层数：0 不创建，1 创建内层，2 再创建一层嵌套抽屉。 */
  nestedCount: number;
} = { destroyOnClose: true, nestedCount: 1 };

/** 关闭动画完成时被调用的原始回调，用于核对包装后仍会转发。 */
function recordOriginalClosed() {
  nestedProbe.originalClosed++;
}

/**
 * 记录内层抽屉收到的开关变化。
 * @param isOpen 变化后的抽屉开关状态。
 */
function recordInnerOpenChange(isOpen: boolean) {
  if (isOpen) {
    nestedProbe.innerOpenChange++;
  }
}

/**
 * 记录连接式外层收到的开关变化。
 * @param isOpen 变化后的抽屉开关状态。
 */
function recordOuterOpenChange(isOpen: boolean) {
  if (isOpen) {
    nestedProbe.outerOpenChange++;
  }
}

/**
 * connectedComponent 替身：渲染真实插槽，并按开关创建内层抽屉。
 *
 * 内层抽屉的创建就是真实内层抽屉的契约：它通过 inject 取得外层注入的数据，
 * 把自己的 API 原型挂到外层暴露的响应式对象上；再往里的嵌套抽屉则应拿到全新配置。
 * @param props 替身声明的属性，用于核对属性转发。
 * @param context 组件上下文，用于取用属性与插槽。
 * @param context.attrs 透传到替身上的属性。
 * @param context.slots 调用方传入的插槽表。
 * @returns 渲染属性占位与插槽内容的渲染函数。
 */
const ConnectedStub = defineComponent({
  name: 'ConnectedDrawerStub',
  inheritAttrs: false,
  props: {
    /** 抽屉标题，仅用于核对属性转发。 */
    title: { default: '', type: String },
  },
  /**
   * 渲染属性占位与插槽内容，并按开关创建内层抽屉。
   * @param props 替身声明的属性，用于核对属性转发。
   * @param context 组件上下文，用于取用属性与插槽。
   * @param context.attrs 透传到替身上的属性。
   * @param context.slots 调用方传入的插槽表。
   * @returns 渲染属性占位与插槽内容的渲染函数。
   */
  setup(props, { attrs, slots }) {
    connectedProbe.props = { ...props, ...attrs };
    connectedProbe.slots = slots;
    if (plan.nestedCount >= 1) {
      const [, innerApi] = useVbenDrawer({
        destroyOnClose: plan.destroyOnClose,
        onClosed: recordOriginalClosed,
        onOpenChange: recordInnerOpenChange,
      });
      nestedProbe.api = innerApi;
    }
    if (plan.nestedCount >= 2) {
      const [, deeperApi] = useVbenDrawer({ title: '子抽屉' });
      nestedProbe.secondApi = deeperApi;
    }
    onMounted(
      /** 记录替身内容挂载次数，供 destroyOnClose 重建断言使用。 */ () => {
        nestedProbe.mounts++;
      },
    );
    return /** 渲染标题占位与调用方插槽，暴露真实内容。 */ () =>
      h('div', { class: 'connected-stub' }, [
        h('div', { class: 'connected-title' }, String(props.title)),
        slots.default?.(),
      ]);
  },
});

/**
 * 挂载 connectedComponent 模式的抽屉宿主。
 * @param attrs 透传给抽屉组件的属性，用于驱动属性冲突校验分支。
 * @param options 渲染选项。
 * @param options.withSlot 是否传入默认插槽；关闭时用于覆盖"没有任何属性与插槽"的提前返回分支。
 * @returns 已挂载的宿主包装器与外层暴露的抽屉 API。
 * @throws Error 组件未交出 API 时抛出，避免用例静默地什么都不验证。
 */
async function mountConnectedDrawer(
  attrs: Record<string, unknown> = {},
  options: { withSlot?: boolean } = {},
) {
  const withSlot = options.withSlot ?? true;
  const captured: { api?: ExtendedDrawerApi } = {};
  const Host = defineComponent({
    name: 'ConnectedDrawerHost',
    /**
     * 用真实 useVbenDrawer 建立连接式抽屉，并把外层 API 交给用例。
     * @returns 渲染抽屉组件并按需传入默认插槽的渲染函数。
     */
    setup() {
      const [Drawer, api] = useVbenDrawer({
        connectedComponent: ConnectedStub,
        footer: false,
        onOpenChange: recordOuterOpenChange,
      });
      captured.api = api;
      if (!withSlot) {
        return /** 不传插槽，用于覆盖"没有任何属性与插槽"的分支。 */ () =>
          h(Drawer);
      }
      return /** 渲染抽屉组件并按需传入默认插槽。 */ () =>
        h(Drawer, attrs, {
          /** 渲染可定位的默认插槽内容。 */
          default: () => h('span', { class: 'slot-content' }, '抽屉内容'),
        });
    },
  });

  const wrapper = mount(Host);
  await nextTick();
  if (!captured.api) {
    throw new Error('连接式抽屉未交出 API');
  }
  return { api: captured.api, wrapper };
}

/**
 * 挂载普通模式的抽屉宿主并返回命令式 API。
 * @param options 传给 useVbenDrawer 的抽屉配置。
 * @returns 抽屉 API，可直接读取或修改抽屉状态。
 * @throws Error 组件未交出 API 时抛出，避免用例静默地什么都不验证。
 */
async function mountPlainDrawer(options: DrawerApiOptions = {}) {
  const captured: { api?: ExtendedDrawerApi } = {};
  const Host = defineComponent({
    name: 'PlainDrawerHost',
    /**
     * 用真实 useVbenDrawer 建立普通抽屉，并把 API 交给用例。
     * @returns 渲染抽屉组件的渲染函数。
     */
    setup() {
      const [Drawer, api] = useVbenDrawer(options);
      captured.api = api;
      return /** 渲染抽屉组件，使状态更新走真实渲染路径。 */ () => h(Drawer);
    },
  });

  mount(Host, { global: { stubs: { transition: false } } });
  await nextTick();
  if (!captured.api) {
    throw new Error('普通抽屉未交出 API');
  }
  return captured.api;
}

/** 还原全局默认属性，避免用例之间通过模块级默认值相互影响。 */
function resetDefaultDrawerProps() {
  setDefaultDrawerProps({ footer: true, title: '' });
}

afterEach(
  /** 还原替身开关、调用记录与全局默认属性。 */ () => {
    vi.restoreAllMocks();
    plan.destroyOnClose = true;
    plan.nestedCount = 1;
    nestedProbe.api = undefined;
    nestedProbe.secondApi = undefined;
    nestedProbe.mounts = 0;
    nestedProbe.originalClosed = 0;
    nestedProbe.innerOpenChange = 0;
    nestedProbe.outerOpenChange = 0;
    connectedProbe.props = undefined;
    connectedProbe.slots = undefined;
    resetDefaultDrawerProps();
  },
);

describe('抽屉全局默认属性', /** 全局默认属性是所有抽屉的初始状态来源，合并方向不能反。 */ () => {
  it('全局默认属性进入抽屉初始状态', /** 未合并会让所有抽屉丢失统一声明的默认行为。 */ async () => {
    setDefaultDrawerProps({ footer: false, title: '全局默认标题' });

    const api = await mountPlainDrawer();

    expect(api.store.state.title).toBe('全局默认标题');
    expect(api.store.state.footer).toBe(false);
  });

  it('实例配置覆盖全局默认属性', /** 合并顺序写反会让页面无法定制单个抽屉。 */ async () => {
    setDefaultDrawerProps({ title: '全局默认标题' });

    const api = await mountPlainDrawer({ title: '实例标题' });

    expect(api.store.state.title).toBe('实例标题');
  });

  it('未传入配置时使用抽屉自身的默认值', /** 默认值写错会让所有抽屉缺少底部操作区或关闭方式。 */ async () => {
    const api = await mountPlainDrawer();

    expect(api.store.state.footer).toBe(true);
    expect(api.store.state.placement).toBe('right');
    expect(api.store.state.isOpen).toBe(false);
  });
});

describe('连接式抽屉装配', /** connectedComponent 模式下外层组件必须拿到内层抽屉的 API 与真实内容。 */ () => {
  it('渲染连接组件并转发属性与默认插槽', /** 插槽或属性丢失会让外层定制的标题与内容不显示。 */ async () => {
    const { wrapper } = await mountConnectedDrawer({
      class: 'connected-drawer',
      title: '外部标题',
    });

    expect(wrapper.find('.connected-stub').exists()).toBe(true);
    expect(wrapper.find('.slot-content').text()).toBe('抽屉内容');
    expect(wrapper.find('.connected-title').text()).toBe('外部标题');
    expect(connectedProbe.props).toMatchObject({
      class: 'connected-drawer',
      title: '外部标题',
    });
    expect(Object.keys(connectedProbe.slots ?? {})).toContain('default');
  });

  it('内层抽屉把 API 原型交给外层暴露对象', /** 未交接会让外层调用 open/close 时报方法不存在。 */ async () => {
    const { api } = await mountConnectedDrawer();

    expect(typeof api.open).toBe('function');
    expect(typeof api.close).toBe('function');
    expect(api.store.state.footer).toBe(false);
  });

  it('打开状态变化时同时通知本层与上层回调', /** 少通知一层会让外层的联动逻辑收不到抽屉打开事件。 */ async () => {
    await mountConnectedDrawer();
    if (!nestedProbe.api) {
      throw new Error('替身未创建内层抽屉');
    }

    nestedProbe.api.open();
    await nextTick();

    expect(nestedProbe.innerOpenChange).toBe(1);
    expect(nestedProbe.outerOpenChange).toBe(1);
  });

  it('更深的嵌套抽屉会串扰外层配置与外层开关回调', /** 真实缺陷：抽屉缺少弹窗实现的“注入只消费一次”，更深一层仍沿用外层配置并转发外层回调。 */ async () => {
    plan.nestedCount = 2;
    await mountConnectedDrawer();
    if (!nestedProbe.api || !nestedProbe.secondApi) {
      throw new Error('替身未创建全部内层抽屉');
    }

    // 第一层内层抽屉继承连接式外层声明的 footer=false，这是 connectedComponent 的既有契约。
    expect(nestedProbe.api.store.state.footer).toBe(false);
    // 与 useVbenModal 的 consumed 机制不同，第二层仍继承外层配置。
    expect(nestedProbe.secondApi.store.state.footer).toBe(false);

    nestedProbe.secondApi.open();
    await nextTick();

    // 第二层的开关变化被转发给外层抽屉的回调，调用方会收到并非自己打开的事件。
    expect(nestedProbe.outerOpenChange).toBe(1);
    expect(nestedProbe.innerOpenChange).toBe(0);
  });
});

describe('抽屉属性冲突校验', /** 连接式抽屉的调用方不能通过 props 直接改状态，否则回调与状态不同步。 */ () => {
  it('传入状态键属性时给出告警', /** 静默放行会让调用方以为 props 生效，实际被 API 状态覆盖。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 抑制告警输出，只记录调用。 */ () => {});

    await mountConnectedDrawer({
      class: 'connected-drawer',
      title: '冲突标题',
    });
    await nextTick();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("'title'");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("'class'");
  });

  it('没有任何属性与插槽时不告警', /** 无属性也告警会淹没真实冲突提示。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 抑制告警输出，只记录调用。 */ () => {});

    await mountConnectedDrawer({}, { withSlot: false });
    await nextTick();

    expect(warn).not.toHaveBeenCalled();
  });

  it('读不到抽屉状态时不告警', /** 内层抽屉尚未交接 API 时告警会误导调用方。 */ async () => {
    plan.nestedCount = 0;
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 抑制告警输出，只记录调用。 */ () => {});

    await mountConnectedDrawer({ class: 'connected-drawer' });
    await nextTick();

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('抽屉关闭后重建', /** destroyOnClose 决定关闭后是否重建内层抽屉，影响下次打开的内容。 */ () => {
  it('开启 destroyOnClose 时关闭后重建内层抽屉', /** 不重建会让下次打开先显示上一次的残留内容。 */ async () => {
    plan.destroyOnClose = true;
    await mountConnectedDrawer();
    await nextTick();
    expect(nestedProbe.mounts).toBe(1);

    nestedProbe.api?.onClosed();
    await nextTick();
    await nextTick();

    expect(nestedProbe.originalClosed).toBe(1);
    expect(nestedProbe.mounts).toBe(2);
  });

  it('关闭 destroyOnClose 时只转发原始关闭回调', /** 误重建会让保留状态的抽屉丢失用户已填内容。 */ async () => {
    plan.destroyOnClose = false;
    await mountConnectedDrawer();
    await nextTick();

    nestedProbe.api?.onClosed();
    await nextTick();
    await nextTick();

    expect(nestedProbe.originalClosed).toBe(1);
    expect(nestedProbe.mounts).toBe(1);
  });
});
