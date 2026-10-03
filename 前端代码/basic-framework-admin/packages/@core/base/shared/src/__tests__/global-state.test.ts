/** 全局共享状态的测试：验证组件注册表与消息提示定义的写入和读取是同一份单例。 */
import { describe, expect, it } from 'vitest';

import { globalShareState } from '../global-state';

/** 第一次注入的提示回调，用于验证重复定义时的覆盖行为。 */
const firstPrompt = () => '第一次';

/** 第二次注入的提示回调，用于验证重复定义时旧回调被替换。 */
const secondPrompt = () => '第二次';

describe('globalShareState', /** 单例在同一次页面生命周期内共享，读取方必须拿到写入方放入的内容。 */ () => {
  it('初始消息表为空', /** 未定义消息提示时读取方应拿到空对象而不是 undefined。 */ () => {
    expect(globalShareState.getMessage()).toEqual({});
  });

  it('定义消息提示后读取到同一函数', /** 复制偏好成功的提示由框架注入，业务侧按名调用。 */ () => {
    /** 模拟业务侧注入的复制成功提示。 */
    const copyPreferencesSuccess = () => '已复制';

    globalShareState.defineMessage({ copyPreferencesSuccess });

    expect(globalShareState.getMessage().copyPreferencesSuccess).toBe(
      copyPreferencesSuccess,
    );
  });

  it('重复定义消息提示会整体覆盖', /** 再次定义时旧提示被替换，避免残留上一次注入的回调。 */ () => {
    globalShareState.defineMessage({ copyPreferencesSuccess: firstPrompt });
    globalShareState.defineMessage({ copyPreferencesSuccess: secondPrompt });

    expect(globalShareState.getMessage().copyPreferencesSuccess?.()).toBe(
      '第二次',
    );
  });

  it('组件表初始为空对象', /** 尚未注册组件时返回空表，业务侧遍历不会报错。 */ () => {
    expect(globalShareState.getComponents()).toEqual({});
  });

  it('写入组件后按同一引用读出', /** 组件注册表整体替换，读写两侧必须看到同一份内容。 */ () => {
    /** 用一个真实组件对象占位，验证注册表不做深拷贝。 */
    const Button = { name: 'FixtureButton' };

    globalShareState.setComponents({ Button });

    expect(globalShareState.getComponents().Button).toBe(Button);
  });
});
