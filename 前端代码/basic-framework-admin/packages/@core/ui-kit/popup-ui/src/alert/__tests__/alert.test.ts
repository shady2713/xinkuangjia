/** 校验 Alert 上下文注入的取值与失败契约，确保确认/取消动作只能来自真实 Provider。 */
import type { Component } from 'vue';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { provideAlertContext, useAlertContext } from '../alert';

/** 用例之间共享的读取结果；每次挂载前由用例重置，避免读到上一个探针的残留。 */
let capturedContext: ReturnType<typeof useAlertContext> | undefined;

/** 挂载失败时由 Vue 的错误处理钩子记录原始异常，供断言核对其类型与文案。 */
let capturedError: unknown;

/**
 * 构造父提供、子注入的最小组件对。
 * @param contextValue 父组件提供给后代的值；传 null 用于模拟运行期传入空值。
 * @param useProvider 是否调用 provideAlertContext，false 时模拟脱离 Provider 使用。
 * @returns 可直接交给 mount 的根组件。
 */
function createProbe(contextValue: unknown, useProvider = true): Component {
  /** 子组件读取上下文，读取结果或异常由用例断言。 */
  const child = () => {
    capturedContext = useAlertContext();
    return null;
  };
  return defineComponent({
    /** 父组件负责提供上下文，确保注入发生在真实的父子链路上。
     * @returns 渲染子探针组件的函数。
     */
    setup() {
      if (useProvider) {
        provideAlertContext(
          contextValue as Parameters<typeof provideAlertContext>[0],
        );
      }
      return /** 渲染子组件以触发注入。 */ () => h(child);
    },
  });
}

/**
 * 挂载探针组件并返回 setup 抛出的异常。
 * @param contextValue 提供给后代的值。
 * @param useProvider 是否提供上下文。
 * @returns 未发生异常时返回 undefined。
 */
function mountProbe(contextValue: unknown, useProvider = true) {
  capturedContext = undefined;
  capturedError = undefined;
  try {
    mount(createProbe(contextValue, useProvider));
  } catch (error) {
    // Vue 在开发模式下会重新抛出 setup 异常，这里保留原始错误供断言核对。
    capturedError = error;
  }
  return capturedError;
}

describe('useAlertContext 上下文读取', /** 确认与取消动作是弹窗的唯一出口，取错上下文会让按钮作用到别的弹窗。 */ () => {
  it('读取到 Provider 提供的同一份上下文并可直接调用动作', /** 返回对象必须与提供值同一引用，且动作回调真实触发。 */ () => {
    const doCancel = vi.fn();
    const doConfirm = vi.fn();
    const context = { doCancel, doConfirm };
    const error = mountProbe(context);
    expect(error).toBeUndefined();
    expect(capturedContext).toBe(context);

    capturedContext?.doConfirm();
    capturedContext?.doCancel();
    expect(doConfirm).toHaveBeenCalledTimes(1);
    expect(doCancel).toHaveBeenCalledTimes(1);
  });

  it('脱离 Provider 使用时抛出注入缺失错误', /** 组件层级写错必须立即失败，而不是拿到 undefined 后在点击时才崩溃。 */ () => {
    const error = mountProbe(undefined, false);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('not found');
    expect(capturedContext).toBeUndefined();
  });

  it('provider 传入空值时抛出 AlertProvider 专用错误', /** 运行期空值（未初始化的上下文）必须给出可定位的提示，而不是继续传递空对象。 */ () => {
    const error = mountProbe(null);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'useAlertContext must be used within an AlertProvider',
    );
  });

  it('两个导出分别可作注入与提供入口使用', /** 导出顺序被外部按数组解构消费，顺序颠倒会让调用方拿到错误的函数。 */ () => {
    expect(useAlertContext).toBeTypeOf('function');
    expect(provideAlertContext).toBeTypeOf('function');
    expect(useAlertContext).not.toBe(provideAlertContext);
  });
});
