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
