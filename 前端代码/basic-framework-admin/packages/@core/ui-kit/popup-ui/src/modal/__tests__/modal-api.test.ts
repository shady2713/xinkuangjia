import type { ModalState } from '../modal';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModalApi } from '../modal-api';

vi.mock(
  '@vben-core/shared/store',
  // 以轻量 Store 替身隔离真实依赖。
  () => {
    return {
      // 判断值是否为函数。
      isFunction: (fn: any) => typeof fn === 'function',
      Store: class {
        /**
         * 读取当前模拟状态。
         * @returns 当前状态。
         */
        get state() {
          return this._state;
        }
        private _listeners = new Set<any>();

        private _state: ModalState;

        /**
         * 创建模拟 Store 并保存初始状态。
         * @param initialState 初始状态。
         */
        constructor(initialState: ModalState) {
          this._state = initialState;
        }

        /**
         * 执行批量更新。
         * @param cb 批量更新回调。
         */
        batch(cb: any) {
          cb();
        }

        /**
         * 更新模拟状态并通知订阅者。
         * @param fn 状态更新函数。
         */
        setState(fn: any) {
          this._state = fn(this._state);
          for (const listener of this._listeners) {
            listener();
          }
        }

        /**
         * 订阅模拟状态变更。
         * @param listener 状态变更回调。
         * @returns 取消订阅函数。
         */
        subscribe(listener: any) {
          this._listeners.add(listener);
          return {
            /** 取消订阅并移除监听器。 */
            unsubscribe: () => this._listeners.delete(listener),
          };
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
