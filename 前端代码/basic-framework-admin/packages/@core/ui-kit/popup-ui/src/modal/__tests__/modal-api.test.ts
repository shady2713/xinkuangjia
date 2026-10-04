import type { ModalState } from '../modal';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModalApi } from '../modal-api';

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
         * 暴露当前弹窗状态，供被测 API 与用例直接读取。
         * @returns 替身当前持有的弹窗状态对象。
         */
        get state() {
          return this._state;
        }
        private _state: ModalState;

        private options: MockStoreOptions;

        /**
         * 替身 Store 的构造入口，只把初始状态与选项存起来，不注册任何外部监听。
         * @param initialState 弹窗的初始状态，作为替身内部状态的起点。
         * @param options 替身选项，本实现只读取其中的 onUpdate 回调。
         */
        constructor(initialState: ModalState, options: MockStoreOptions) {
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
            prev: ModalState,
          ) => ModalState,
        ) {
          this._state = fn(this._state);
          this.options.onUpdate();
        }
      },
    };
  },
);

describe('modalApi', /** 逐项核对弹窗 API 的状态读写、回调转发与默认关闭路径。 */ () => {
  let modalApi: ModalApi;
  // 使用 modalState 而不是 state
  let modalState: ModalState;

  beforeEach(() => {
    modalApi = new ModalApi();
    // 获取 modalApi 内的 state
    modalState = modalApi.store.state;
  });

  it('should initialize with default state', () => {
    expect(modalState.isOpen).toBe(false);
    expect(modalState.cancelText).toBe(undefined);
    expect(modalState.confirmText).toBe(undefined);
  });

  it('should open the modal', () => {
    modalApi.open();
    expect(modalApi.store.state.isOpen).toBe(true);
  });

  it('should close the modal if onBeforeClose allows it', () => {
    modalApi.close();
    expect(modalApi.store.state.isOpen).toBe(false);
  });

  it('should not close the modal if onBeforeClose returns false', () => {
    const onBeforeClose = vi.fn(() => false);
    const modalApiWithHook = new ModalApi({ onBeforeClose });
    modalApiWithHook.open();
    modalApiWithHook.close();
    expect(modalApiWithHook.store.state.isOpen).toBe(true);
    expect(onBeforeClose).toHaveBeenCalled();
  });

  it('should trigger onCancel and close the modal if no onCancel hook is provided', () => {
    const onCancel = vi.fn();
    const modalApiWithHook = new ModalApi({ onCancel });
    modalApiWithHook.open();
    modalApiWithHook.onCancel();
    expect(onCancel).toHaveBeenCalled();
    expect(modalApiWithHook.store.state.isOpen).toBe(true);
  });

  it('should update shared data correctly', () => {
    const testData = { key: 'value' };
    modalApi.setData(testData);
    expect(modalApi.getData()).toEqual(testData);
  });

  it('should set state correctly using an object', () => {
    modalApi.setState({ title: 'New Title' });
    expect(modalApi.store.state.title).toBe('New Title');
  });

  it('should set state correctly using a function', () => {
    modalApi.setState((prev) => ({ ...prev, confirmText: 'Yes' }));
    expect(modalApi.store.state.confirmText).toBe('Yes');
  });

  it('should call onOpenChange when state changes', () => {
    const onOpenChange = vi.fn();
    const modalApiWithHook = new ModalApi({ onOpenChange });
    modalApiWithHook.open();
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('should call onClosed callback when provided', () => {
    const onClosed = vi.fn();
    const modalApiWithHook = new ModalApi({ onClosed });
    modalApiWithHook.onClosed();
    expect(onClosed).toHaveBeenCalled();
  });

  it('should call onOpened callback when provided', () => {
    const onOpened = vi.fn();
    const modalApiWithHook = new ModalApi({ onOpened });
    modalApiWithHook.open();
    modalApiWithHook.onOpened();
    expect(onOpened).toHaveBeenCalled();
  });
  it('lock 与 unlock 切换提交锁定状态', /** 提交期间必须锁住弹窗，结束后必须恢复，否则用户会看到永久 loading。 */ () => {
    modalApi.lock();
    expect(modalApi.store.state.submitting).toBe(true);

    modalApi.unlock();
    expect(modalApi.store.state.submitting).toBe(false);
  });

  it('lock 接受显式布尔值作为目标锁定状态', /** 默认参数只覆盖省略场景，显式传 false 必须等价于 unlock。 */ () => {
    modalApi.lock(false);
    expect(modalApi.store.state.submitting).toBe(false);

    modalApi.lock(true);
    expect(modalApi.store.state.submitting).toBe(true);
  });

  it('未提供 onCancel 时取消动作会关闭弹窗', /** 没有自定义取消回调时必须走默认关闭路径，否则取消按钮点击无效果。 */ async () => {
    modalApi.open();
    expect(modalApi.store.state.isOpen).toBe(true);

    modalApi.onCancel();
    await vi.waitFor(
      /** 关闭是异步流程，等到状态真正落库后再断言。 */ () => {
        expect(modalApi.store.state.isOpen).toBe(false);
      },
    );
  });

  it('onConfirm 把确认动作转发给已注册回调', /** 确认按钮只负责转发，回调缺失时不应吞掉或重复调用。 */ () => {
    const onConfirm = vi.fn();
    const modalApiWithHook = new ModalApi({ onConfirm });

    modalApiWithHook.onConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // 负对照：未注册回调时调用不能抛错，也不能凭空产生调用。
    expect(
      /** 触发一次无回调的确认动作，确认不会抛错。 */ () =>
        modalApi.onConfirm(),
    ).not.toThrow();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
