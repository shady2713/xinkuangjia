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

describe('modalApi', () => {
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
});
