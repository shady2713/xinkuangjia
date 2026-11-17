import type { DrawerState } from '../drawer';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DrawerApi } from '../drawer-api';

// 模拟 Store 类
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

        private _state: DrawerState;

        /**
         * 创建模拟 Store 并保存初始状态。
         * @param initialState 初始状态。
         */
        constructor(initialState: DrawerState) {
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

describe('drawerApi', () => {
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
});
