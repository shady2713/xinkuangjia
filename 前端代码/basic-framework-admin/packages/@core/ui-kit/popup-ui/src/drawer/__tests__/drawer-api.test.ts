/**
 * DrawerApi 的契约测试：用最小 Store 替身锁定开合、
 * 状态写入与回调转发。覆盖 onBeforeClose 拦截、
 * onCancel 默认关闭、lock/unlock 提交锁定等边界；
 * 不涉及 drawer.vue 的渲染、动画与遮罩交互。
 */
import type { DrawerState } from '../drawer';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DrawerApi } from '../drawer-api';

/** 被测代码只用到 onUpdate，这里按实际依赖收窄 mock 的选项形状。 */
interface MockStoreOptions {
  /** 每次 setState 之后由替身触发，用例据此确认状态确实被写入。 */
  onUpdate: () => void;
}

vi.mock(
  '@vben-core/shared/store',
  /** 用最小实现替换真实 Store，使被测 API 能在无浏览器环境下运行。 */ () => {
    return {
      /** 沿用真实实现的函数判定口径，供被测 API 复用。 */
      isFunction: (fn: unknown) => typeof fn === 'function',
      Store: class {
        /**
         * 暴露当前抽屉状态，供被测 API 与用例直接读取。
         * @returns 替身当前持有的抽屉状态对象。
         */
        get state() {
          return this._state;
        }
        private _state: DrawerState;

        private options: MockStoreOptions;

        /**
         * 替身 Store 的构造入口，只把初始状态与选项存起来，不注册任何外部监听。
         * @param initialState 抽屉的初始状态，作为替身内部状态的起点。
         * @param options 替身选项，本实现只读取其中的 onUpdate 回调。
         */
        constructor(initialState: DrawerState, options: MockStoreOptions) {
          this._state = initialState;
          this.options = options;
        }

        /**
         * 替身只做同步执行，不提供真实 Store 的批处理合并语义。
         * @param cb 批处理回调，本替身立即同步调用一次。
         */
        batch(
          cb: /** 立即同步执行的批处理回调，用于跑完一次状态更新。 */ () => void,
        ) {
          cb();
        }

        /**
         * 用计算结果覆盖内部状态，并触发一次 onUpdate 让用例观察到写入。
         * @param fn 由旧状态推算新状态的函数，返回值直接成为新的内部状态。
         */
        setState(
          fn: /** 计算新状态的函数，返回值会覆盖替身内部状态。 */ (
            prev: DrawerState,
          ) => DrawerState,
        ) {
          this._state = fn(this._state);
          this.options.onUpdate();
        }
      },
    };
  },
);

describe('drawerApi', /** 逐项核对弹窗 API 的状态读写、回调转发与默认关闭路径。 */ () => {
  let drawerApi: DrawerApi;
  let drawerState: DrawerState;

  beforeEach(() => {
    drawerApi = new DrawerApi();
    drawerState = drawerApi.store.state;
  });

  it('should initialize with default state', () => {
    expect(drawerState.isOpen).toBe(false);
    expect(drawerState.cancelText).toBe(undefined);
    expect(drawerState.confirmText).toBe(undefined);
  });

  it('should open the drawer', () => {
    drawerApi.open();
    expect(drawerApi.store.state.isOpen).toBe(true);
  });

  it('should close the drawer if onBeforeClose allows it', () => {
    drawerApi.close();
    expect(drawerApi.store.state.isOpen).toBe(false);
  });

  it('should not close the drawer if onBeforeClose returns false', () => {
    /** 模拟关闭前校验拒绝放行：钩子返回 false 时抽屉必须保持打开且钩子被调用。 */
    const onBeforeClose = vi.fn(() => false);
    const drawerApiWithHook = new DrawerApi({ onBeforeClose });
    drawerApiWithHook.open();
    drawerApiWithHook.close();
    expect(drawerApiWithHook.store.state.isOpen).toBe(true);
    expect(onBeforeClose).toHaveBeenCalled();
  });

  it('should trigger onCancel and keep drawer open if onCancel is provided', () => {
    const onCancel = vi.fn();
    const drawerApiWithHook = new DrawerApi({ onCancel });
    drawerApiWithHook.open();
    drawerApiWithHook.onCancel();
    expect(onCancel).toHaveBeenCalled();
    expect(drawerApiWithHook.store.state.isOpen).toBe(true); // 关闭逻辑不在 onCancel 内
  });

  it('should update shared data correctly', () => {
    const testData = { key: 'value' };
    drawerApi.setData(testData);
    expect(drawerApi.getData()).toEqual(testData);
  });

  it('should set state correctly using an object', () => {
    drawerApi.setState({ title: 'New Title' });
    expect(drawerApi.store.state.title).toBe('New Title');
  });

  it('should set state correctly using a function', () => {
    drawerApi.setState((prev) => ({ ...prev, confirmText: 'Yes' }));
    expect(drawerApi.store.state.confirmText).toBe('Yes');
  });

  it('should call onOpenChange when state changes', () => {
    const onOpenChange = vi.fn();
    const drawerApiWithHook = new DrawerApi({ onOpenChange });
    drawerApiWithHook.open();
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('should call onClosed callback when provided', () => {
    const onClosed = vi.fn();
    const drawerApiWithHook = new DrawerApi({ onClosed });
    drawerApiWithHook.onClosed();
    expect(onClosed).toHaveBeenCalled();
  });

  it('should call onOpened callback when provided', () => {
    const onOpened = vi.fn();
    const drawerApiWithHook = new DrawerApi({ onOpened });
    drawerApiWithHook.open();
    drawerApiWithHook.onOpened();
    expect(onOpened).toHaveBeenCalled();
  });
  it('lock 与 unlock 切换提交锁定状态', /** 提交期间必须锁住抽屉，结束后必须恢复，否则用户会看到永久 loading。 */ () => {
    drawerApi.lock();
    expect(drawerApi.store.state.submitting).toBe(true);

    drawerApi.unlock();
    expect(drawerApi.store.state.submitting).toBe(false);
  });

  it('lock 接受显式布尔值作为目标锁定状态', /** 默认参数只覆盖省略场景，显式传 false 必须等价于 unlock。 */ () => {
    drawerApi.lock(false);
    expect(drawerApi.store.state.submitting).toBe(false);

    drawerApi.lock(true);
    expect(drawerApi.store.state.submitting).toBe(true);
  });

  it('未提供 onCancel 时取消动作会关闭抽屉', /** 没有自定义取消回调时必须走默认关闭路径，否则取消按钮点击无效果。 */ async () => {
    drawerApi.open();
    expect(drawerApi.store.state.isOpen).toBe(true);

    drawerApi.onCancel();
    await vi.waitFor(
      /** 关闭是异步流程，等到状态真正落库后再断言。 */ () => {
        expect(drawerApi.store.state.isOpen).toBe(false);
      },
    );
  });

  it('onConfirm 把确认动作转发给已注册回调', /** 确认按钮只负责转发，回调缺失时不应吞掉或重复调用。 */ () => {
    const onConfirm = vi.fn();
    const drawerApiWithHook = new DrawerApi({ onConfirm });

    drawerApiWithHook.onConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // 负对照：未注册回调时调用不能抛错，也不能凭空产生调用。
    expect(
      /** 触发一次无回调的确认动作，确认不会抛错。 */ () =>
        drawerApi.onConfirm(),
    ).not.toThrow();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
