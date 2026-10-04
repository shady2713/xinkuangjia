/** 校验表单渲染的运行时形状判定：对象收窄与事件对象识别必须与真实消费方一致。 */
import { describe, expect, it } from 'vitest';

import { isEventObjectLike, isValueRecord } from '../src/form-render/helper';

/** 构造同时具备 target 与 stopPropagation 的控件事件替身。 */
function createEventLike(target: unknown) {
  return {
    /** 事件对象必须提供可调用的停止传播方法。 */
    stopPropagation: () => {},
    target,
  };
}

describe('isValueRecord 对象收窄', /** form-api 依赖该判定读取组件实例的 $el，误判会让焦点定位落到错误分支。 */ () => {
  it('普通对象与无原型对象都视为记录', /** 任何非数组对象都应可安全按字符串键读取成员。 */ () => {
    expect(isValueRecord({})).toBe(true);
    expect(isValueRecord({ value: 1 })).toBe(true);
    expect(isValueRecord(Object.create(null))).toBe(true);
  });

  it('数组、null 与基本类型都不是记录', /** 数组没有字符串字段语义，null 与基本类型更不能直接取成员。 */ () => {
    expect(isValueRecord([])).toBe(false);
    expect(isValueRecord([1, 2])).toBe(false);
    expect(isValueRecord(null)).toBe(false);
    expect(isValueRecord(undefined)).toBe(false);
    expect(isValueRecord('text')).toBe(false);
    expect(isValueRecord(0)).toBe(false);
    expect(isValueRecord(false)).toBe(false);
    expect(isValueRecord(Symbol('s'))).toBe(false);
  });

  it('函数不视为记录', /** typeof 为 function 的取值不参与字段读取，避免把组件工厂当成数据对象。 */ () => {
    expect(isValueRecord(/** 空箭头函数取值。 */ () => {})).toBe(false);
    expect(
      isValueRecord(/** 带名字的函数声明同样不参与字段读取。 */ () => {}),
    ).toBe(false);
  });
});

describe('isEventObjectLike 控件事件识别', /** form-field 用它决定是否把回传值还原为 target 字段，误判会让表单收到事件对象。 */ () => {
  it('同时具备记录型 target 与停止传播方法时判定为事件', /** 这是第三方控件回传事件对象的标准形状。 */ () => {
    expect(isEventObjectLike(createEventLike({ value: 'abc' }))).toBe(true);
    expect(isEventObjectLike(createEventLike({}))).toBe(true);
  });

  it('target 不是记录时判定为非事件', /** target 为字符串或数组说明这已经是真实字段值，不能再向下取字段。 */ () => {
    expect(isEventObjectLike(createEventLike('abc'))).toBe(false);
    expect(isEventObjectLike(createEventLike([1, 2]))).toBe(false);
    expect(isEventObjectLike(createEventLike(null))).toBe(false);
    expect(isEventObjectLike(createEventLike(undefined))).toBe(false);
  });

  it('缺少停止传播方法时判定为非事件', /** 纯数据对象可能恰好带 target 字段，缺少方法时不能按事件解包。 */ () => {
    expect(isEventObjectLike({ target: { value: 'abc' } })).toBe(false);
    expect(
      isEventObjectLike({ stopPropagation: 1, target: { value: 1 } }),
    ).toBe(false);
    expect(
      isEventObjectLike({
        /** 只有可调用的停止传播方法才算事件。 */
        stopPropagation: () => {},
      }),
    ).toBe(false);
  });

  it('非对象取值一律判定为非事件', /** 基本类型与数组没有 target 语义，必须先被对象判定拦下。 */ () => {
    expect(isEventObjectLike(null)).toBe(false);
    expect(isEventObjectLike(undefined)).toBe(false);
    expect(isEventObjectLike('event')).toBe(false);
    expect(isEventObjectLike(12)).toBe(false);
    expect(isEventObjectLike([])).toBe(false);
    expect(isEventObjectLike(/** 函数取值没有 target 语义。 */ () => {})).toBe(
      false,
    );
  });

  it('可安全读取真实事件目标字段', /** 收窄后按类型声明读取 target 字段必须取到控件真实值。 */ () => {
    const event = createEventLike({ value: 'hello' });
    expect(isEventObjectLike(event)).toBe(true);
    if (isEventObjectLike(event)) {
      expect(event.target.value).toBe('hello');
    }
  });
});
