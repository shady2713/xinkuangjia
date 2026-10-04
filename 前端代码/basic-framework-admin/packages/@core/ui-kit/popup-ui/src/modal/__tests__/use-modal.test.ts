/**
 * 弹窗声明入口（popup-ui 的 use-modal）真实行为回归。
 *
 * `useVbenModal` 是全部业务弹窗的入口：connectedComponent 模式把内层弹窗的 API 通过
 * provide/inject 交给外层组件，非连接模式直接创建 API。全局默认属性合并错会让所有
 * 弹窗丢失默认行为，嵌套弹窗误继承上层配置会让子弹窗带上父弹窗的按钮与标题，
 * destroyOnClose 未重建会让下次打开残留上一次的内容，属性冲突校验缺失会让调用方
 * 绕过 API 直接改状态导致回调与状态不同步。用例按业务用法挂载真实组件，
 * 只替换弹窗内容渲染边界，注入、合并、重建与校验全部按真实实现执行。
 */
import type { ExtendedModalApi, ModalApiOptions } from '../modal';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, onMounted } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { setDefaultModalProps, useVbenModal } from '../use-modal';

/** connectedComponent 替身收到的渲染入参，用于核对属性与插槽转发。 */
const connectedProbe: {
  /** 替身收到的 props 与 attrs 合并结果。 */
  props?: Record<string, unknown>;
  /** 替身收到的插槽表。 */
  slots?: Record<string, unknown>;
} = {};

/** 内层弹窗的 API 与调用记录；替身创建内层弹窗时写入。 */
const nestedProbe: {
  /** 第一层内层弹窗 API，用例用它触发关闭动画完成回调。 */
  api?: ExtendedModalApi;
  /** 内层弹窗收到的开关变化次数。 */
  innerOpenChange: number;
  /** 替身内容被挂载的次数，用于判断 destroyOnClose 是否重建。 */
  mounts: number;
  /** 内层弹窗声明的原始关闭回调调用次数。 */
  originalClosed: number;
  /** 连接式外层收到的开关变化次数。 */
  outerOpenChange: number;
  /** 第二层内层弹窗 API，用于核对嵌套弹窗不继承上层配置。 */
  secondApi?: ExtendedModalApi;
} = { innerOpenChange: 0, mounts: 0, originalClosed: 0, outerOpenChange: 0 };

/** 替身行为开关：内层弹窗层数与 destroyOnClose 配置。 */
const plan: {
  /** 是否开启 destroyOnClose。 */
  destroyOnClose: boolean;
  /** 替身创建的内层弹窗层数：0 不创建，1 创建内层，2 再创建一层嵌套弹窗。 */
  nestedCount: number;
} = { destroyOnClose: true, nestedCount: 1 };

/** 关闭动画完成时被调用的原始回调，用于核对包装后仍会转发。 */
function recordOriginalClosed() {
  nestedProbe.originalClosed++;
}

/**
 * 记录内层弹窗收到的开关变化。
 * @param isOpen 变化后的弹窗开关状态。
 */
function recordInnerOpenChange(isOpen: boolean) {
  if (isOpen) {
    nestedProbe.innerOpenChange++;
  }
}

/**
 * 记录连接式外层收到的开关变化。
 * @param isOpen 变化后的弹窗开关状态。
 */
function recordOuterOpenChange(isOpen: boolean) {
  if (isOpen) {
    nestedProbe.outerOpenChange++;
  }
}

/**
 * connectedComponent 替身：渲染真实插槽，并按开关创建内层弹窗。
 *
 * 内层弹窗的创建就是真实内层弹窗的契约：它通过 inject 取得外层注入的数据，
 * 把自己的 API 原型挂到外层暴露的响应式对象上；再往里的嵌套弹窗则应拿到全新配置。
 * @param props 替身声明的属性，用于核对属性转发。
 * @param context 组件上下文，用于取用属性与插槽。
 * @param context.attrs 透传到替身上的属性。
 * @param context.slots 调用方传入的插槽表。
 * @returns 渲染属性占位与插槽内容的渲染函数。
 */
const ConnectedStub = defineComponent({
  name: 'ConnectedModalStub',
  inheritAttrs: false,
  props: {
    /** 弹窗标题，仅用于核对属性转发。 */
    title: { default: '', type: String },
  },
  /**
   * 渲染属性占位与插槽内容，并按开关创建内层弹窗。
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
      const [, innerApi] = useVbenModal({
        destroyOnClose: plan.destroyOnClose,
        onClosed: recordOriginalClosed,
        onOpenChange: recordInnerOpenChange,
      });
      nestedProbe.api = innerApi;
    }
    if (plan.nestedCount >= 2) {
      const [, deeperApi] = useVbenModal({ title: '子弹窗' });
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
 * 挂载 connectedComponent 模式的弹窗宿主。
 * @param attrs 透传给弹窗组件的属性，用于驱动属性冲突校验分支。
 * @param options 渲染选项。
 * @param options.withSlot 是否传入默认插槽；关闭时用于覆盖"没有任何属性与插槽"的提前返回分支。
 * @returns 已挂载的宿主包装器与外层暴露的弹窗 API。
 * @throws Error 组件未交出 API 时抛出，避免用例静默地什么都不验证。
 */
async function mountConnectedModal(
  attrs: Record<string, unknown> = {},
  options: { withSlot?: boolean } = {},
) {
  const withSlot = options.withSlot ?? true;
  const captured: { api?: ExtendedModalApi } = {};
  const Host = defineComponent({
    name: 'ConnectedModalHost',
    /**
     * 用真实 useVbenModal 建立连接式弹窗，并把外层 API 交给用例。
     * @returns 渲染弹窗组件并按需传入默认插槽的渲染函数。
     */
    setup() {
      const [Modal, api] = useVbenModal({
        connectedComponent: ConnectedStub,
        footer: false,
        onOpenChange: recordOuterOpenChange,
      });
      captured.api = api;
      if (!withSlot) {
        return /** 不传插槽，用于覆盖"没有任何属性与插槽"的分支。 */ () =>
          h(Modal);
      }
      return /** 渲染弹窗组件并按需传入默认插槽。 */ () =>
        h(Modal, attrs, {
          /** 渲染可定位的默认插槽内容。 */
          default: () => h('span', { class: 'slot-content' }, '弹窗内容'),
        });
    },
  });

  const wrapper = mount(Host);
  await nextTick();
  if (!captured.api) {
    throw new Error('连接式弹窗未交出 API');
  }
  return { api: captured.api, wrapper };
}

/**
 * 挂载普通模式的弹窗宿主并返回命令式 API。
 * @param options 传给 useVbenModal 的弹窗配置。
 * @returns 弹窗 API，可直接读取或修改弹窗状态。
 * @throws Error 组件未交出 API 时抛出，避免用例静默地什么都不验证。
 */
async function mountPlainModal(options: ModalApiOptions = {}) {
  const captured: { api?: ExtendedModalApi } = {};
  const Host = defineComponent({
    name: 'PlainModalHost',
    /**
     * 用真实 useVbenModal 建立普通弹窗，并把 API 交给用例。
     * @returns 渲染弹窗组件的渲染函数。
     */
    setup() {
      const [Modal, api] = useVbenModal(options);
      captured.api = api;
      return /** 渲染弹窗组件，使状态更新走真实渲染路径。 */ () => h(Modal);
    },
  });

  mount(Host);
  await nextTick();
  if (!captured.api) {
    throw new Error('普通弹窗未交出 API');
  }
  return captured.api;
}

/** 还原全局默认属性，避免用例之间通过模块级默认值相互影响。 */
function resetDefaultModalProps() {
  setDefaultModalProps({ confirmDisabled: false, title: '' });
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
    resetDefaultModalProps();
  },
);

describe('弹窗全局默认属性', /** 全局默认属性是所有弹窗的初始状态来源，合并方向不能反。 */ () => {
  it('全局默认属性进入弹窗初始状态', /** 未合并会让所有弹窗丢失统一声明的默认行为。 */ async () => {
    setDefaultModalProps({ confirmDisabled: true, title: '全局默认标题' });

    const api = await mountPlainModal();

    expect(api.store.state.title).toBe('全局默认标题');
    expect(api.store.state.confirmDisabled).toBe(true);
  });

  it('实例配置覆盖全局默认属性', /** 合并顺序写反会让页面无法定制单个弹窗。 */ async () => {
    setDefaultModalProps({ title: '全局默认标题' });

    const api = await mountPlainModal({ title: '实例标题' });

    expect(api.store.state.title).toBe('实例标题');
  });
});

describe('连接式弹窗装配', /** connectedComponent 模式下外层组件必须拿到内层弹窗的 API 与真实内容。 */ () => {
  it('渲染连接组件并转发属性与默认插槽', /** 插槽或属性丢失会让外层定制的标题与内容不显示。 */ async () => {
    const { wrapper } = await mountConnectedModal({
      class: 'connected-modal',
      title: '外部标题',
    });

    expect(wrapper.find('.connected-stub').exists()).toBe(true);
    expect(wrapper.find('.slot-content').text()).toBe('弹窗内容');
    expect(wrapper.find('.connected-title').text()).toBe('外部标题');
    expect(connectedProbe.props).toMatchObject({
      class: 'connected-modal',
      title: '外部标题',
    });
    expect(Object.keys(connectedProbe.slots ?? {})).toContain('default');
  });

  it('内层弹窗把 API 原型交给外层暴露对象', /** 未交接会让外层调用 open/close 时报方法不存在。 */ async () => {
    const { api } = await mountConnectedModal();

    expect(typeof api.open).toBe('function');
    expect(typeof api.close).toBe('function');
    expect(api.store.state.footer).toBe(false);
  });

  it('打开状态变化时同时通知本层与上层回调', /** 少通知一层会让外层的联动逻辑收不到弹窗打开事件。 */ async () => {
    await mountConnectedModal();
    if (!nestedProbe.api) {
      throw new Error('替身未创建内层弹窗');
    }

    nestedProbe.api.open();
    await nextTick();

    expect(nestedProbe.innerOpenChange).toBe(1);
    expect(nestedProbe.outerOpenChange).toBe(1);
  });

  it('再嵌套的弹窗不继承上层配置', /** 继承上层配置会让子弹窗带上父弹窗的按钮与标题。 */ async () => {
    plan.nestedCount = 2;
    await mountConnectedModal();
    if (!nestedProbe.api || !nestedProbe.secondApi) {
      throw new Error('替身未创建全部内层弹窗');
    }

    // 第一层内层弹窗继承连接式外层声明的 footer=false，再往里一层必须回到默认值
    expect(nestedProbe.api.store.state.footer).toBe(false);
    expect(nestedProbe.secondApi.store.state.footer).toBe(true);
  });
});

describe('弹窗属性冲突校验', /** 连接式弹窗的调用方不能通过 props 直接改状态，否则回调与状态不同步。 */ () => {
  it('传入状态键属性时给出告警', /** 静默放行会让调用方以为 props 生效，实际被 API 状态覆盖。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 抑制告警输出，只记录调用。 */ () => {});

    await mountConnectedModal({ class: 'connected-modal', title: '冲突标题' });
    await nextTick();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("'title'");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("'class'");
  });

  it('没有任何属性与插槽时不告警', /** 无属性也告警会淹没真实冲突提示。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 抑制告警输出，只记录调用。 */ () => {});

    await mountConnectedModal({}, { withSlot: false });
    await nextTick();

    expect(warn).not.toHaveBeenCalled();
  });

  it('读不到弹窗状态时不告警', /** 内层弹窗尚未交接 API 时告警会误导调用方。 */ async () => {
    plan.nestedCount = 0;
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 抑制告警输出，只记录调用。 */ () => {});

    await mountConnectedModal({ class: 'connected-modal' });
    await nextTick();

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('弹窗关闭后重建', /** destroyOnClose 决定关闭后是否重建内层弹窗，影响下次打开的内容。 */ () => {
  it('开启 destroyOnClose 时关闭后重建内层弹窗', /** 不重建会让下次打开先显示上一次的残留内容。 */ async () => {
    plan.destroyOnClose = true;
    await mountConnectedModal();
    await nextTick();
    expect(nestedProbe.mounts).toBe(1);

    nestedProbe.api?.onClosed();
    await nextTick();
    await nextTick();

    expect(nestedProbe.originalClosed).toBe(1);
    expect(nestedProbe.mounts).toBe(2);
  });

  it('关闭 destroyOnClose 时只转发原始关闭回调', /** 误重建会让保留状态的弹窗丢失用户已填内容。 */ async () => {
    plan.destroyOnClose = false;
    await mountConnectedModal();
    await nextTick();

    nestedProbe.api?.onClosed();
    await nextTick();
    await nextTick();

    expect(nestedProbe.originalClosed).toBe(1);
    expect(nestedProbe.mounts).toBe(1);
  });
});
