/** 通用对象工具的测试：方法绑定、嵌套取值、链接参数、按目标结构复制、分组与 JSON 解析。 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bindMethods,
  copyValueToTarget,
  getNestedValue,
  getUrlNumberValue,
  getUrlValue,
  groupBy,
  jsonParse,
} from '../util';

/** 验证 bindMethods 的测试类：构造时把原型方法绑定到实例自身。 */
class TestClass {
  public value: string;

  /**
   * 记录初始值并立即绑定原型方法。
   * @param value - 实例的初始值。
   */
  constructor(value: string) {
    this.value = value;
    bindMethods(this); // 调用通用方法
  }

  /**
   * 读取当前值。
   * @returns 实例上的 value 字段。
   */
  getValue() {
    return this.value;
  }

  /**
   * 覆盖当前值。
   * @param newValue - 新的值，直接写入实例字段。
   */
  setValue(newValue: string) {
    this.value = newValue;
  }
}

describe('bindMethods', () => {
  it('should bind methods to the instance correctly', () => {
    const instance = new TestClass('initial');

    // 解构方法
    const { getValue } = instance;

    // 检查 getValue 是否能正确调用，并且 this 绑定了 instance
    expect(getValue()).toBe('initial');
  });

  it('should bind multiple methods', () => {
    const instance = new TestClass('initial');

    const { getValue, setValue } = instance;

    // 检查 getValue 和 setValue 方法是否正确绑定了 this
    setValue('newValue');
    expect(getValue()).toBe('newValue');
  });

  it('should not bind non-function properties', () => {
    const instance = new TestClass('initial');

    // 检查普通属性是否保持原样
    expect(instance.value).toBe('initial');
  });

  it('should not bind constructor method', () => {
    const instance = new TestClass('test');

    // 检查 constructor 是否没有被绑定
    expect(instance.constructor.name).toBe('TestClass');
  });

  it('should not bind getter/setter properties', () => {
    /** 只带 getter/setter 的测试类，用来确认 bindMethods 不会把访问器改写掉。 */
    class TestWithGetterSetter {
      /**
       * 读取内部字段。
       * @returns 当前的 _value。
       */
      get value() {
        return this._value;
      }

      /**
       * 写入内部字段。
       * @param newValue - 新的字符串值。
       */
      set value(newValue: string) {
        this._value = newValue;
      }

      private _value: string = 'test';

      /** 构造后立即调用 bindMethods，供用例检查访问器是否保持原样。 */
      constructor() {
        bindMethods(this);
      }
    }

    const instance = new TestWithGetterSetter();
    const { value } = instance;

    // Getter 和 setter 不应被绑定
    expect(value).toBe('test');
  });
});

describe('getNestedValue', /** 按点分路径逐层取值，路径穿过原始值时返回 undefined。 */ () => {
  /** 用户资料片段：点分路径取值用例的中间层。 */
  interface UserProfile {
    age: number;
    name: string;
  }

  /** 用户设置片段：与 UserProfile 平级，用于验证多分支路径。 */
  interface UserSettings {
    theme: string;
  }

  /** 用例根对象：user 下同时挂 profile 与 settings 两条路径。 */
  interface Data {
    user: {
      profile: UserProfile;
      settings: UserSettings;
    };
  }

  const data: Data = {
    user: {
      profile: {
        age: 25,
        name: 'Alice',
      },
      settings: {
        theme: 'dark',
      },
    },
  };

  it('should get a nested value when the path is valid', () => {
    const result = getNestedValue(data, 'user.profile.name');
    expect(result).toBe('Alice');
  });

  it('should return undefined for non-existent property', () => {
    const result = getNestedValue(data, 'user.profile.gender');
    expect(result).toBeUndefined();
  });

  it('should return undefined when accessing a non-existent deep path', () => {
    const result = getNestedValue(data, 'user.nonexistent.field');
    expect(result).toBeUndefined();
  });

  it('should return undefined if a middle level is undefined', () => {
    const result = getNestedValue({ user: undefined }, 'user.profile.name');
    expect(result).toBeUndefined();
  });

  it('should return the correct value for a nested setting', () => {
    const result = getNestedValue(data, 'user.settings.theme');
    expect(result).toBe('dark');
  });

  it('should work for a single-level path', () => {
    const result = getNestedValue({ a: 1, b: 2 }, 'b');
    expect(result).toBe(2);
  });

  it('should throw if path is empty', /** 空路径没有可读取的键，必须显式拒绝而不是返回整个对象。 */ () => {
    expect(
      /** 空路径调用必须抛错，而不是返回整个对象。 */ () =>
        getNestedValue(data, ''),
    ).toThrow();
  });

  it('should handle paths with array indexes', () => {
    const complexData = { list: [{ name: 'Item1' }, { name: 'Item2' }] };
    const result = getNestedValue(complexData, 'list.1.name');
    expect(result).toBe('Item2');
  });

  it('should return undefined when accessing an out-of-bounds array index', () => {
    const complexData = { list: [{ name: 'Item1' }] };
    const result = getNestedValue(complexData, 'list.2.name');
    expect(result).toBeUndefined();
  });

  it('should return undefined when a path segment runs through a primitive', /** 原始值上取属性没有意义，必须返回 undefined 而不是抛错。 */ () => {
    expect(getNestedValue({ count: 5 }, 'count.toFixed')).toBeUndefined();
    expect(
      getNestedValue({ name: 'a' }, 'name.length.toFixed'),
    ).toBeUndefined();
  });
});

describe('getUrlValue 与 getUrlNumberValue', /** 从链接上读取查询参数，缺失时给出确定的空值。 */ () => {
  it('reads an existing query parameter', /** 链接上的查询参数应原样返回。 */ () => {
    expect(getUrlValue('page', 'https://host.com/list?page=2')).toBe('2');
  });

  it('returns an empty string for a missing parameter', /** 参数不存在时返回空串，调用方无需再判空。 */ () => {
    expect(getUrlValue('missing', 'https://host.com/list?page=2')).toBe('');
  });

  it('decodes percent-encoded values', /** 编码后的参数要还原成可读文本。 */ () => {
    expect(
      getUrlValue('name', 'https://host.com/list?name=%E5%BC%A0%E4%B8%89'),
    ).toBe('张三');
  });

  it('returns an empty string when the url or key is empty', /** 空地址或空键名都直接返回空串。 */ () => {
    expect(getUrlValue('page', '')).toBe('');
    expect(getUrlValue('', 'https://host.com/list?page=2')).toBe('');
  });

  it('reads a numeric query parameter', /** 分页参数需要数值，缺失时得到 NaN 由调用方决定兜底。 */ () => {
    expect(getUrlNumberValue('page', 'https://host.com/list?page=3')).toBe(3);
  });

  it('converts a non-numeric value to NaN', /** 不能把 'abc' 静默变成 0。 */ () => {
    expect(
      getUrlNumberValue('page', 'https://host.com/list?page=abc'),
    ).toBeNaN();
  });

  it('reads from the current location by default', /** 不传地址时读当前页面。 */ () => {
    expect(
      getUrlValue('page', `${location.origin}${location.pathname}?page=9`),
    ).toBe('9');
  });
});

describe('copyValueToTarget', /** 把源对象的同名属性写回目标对象，源对象多出的键必须被剔除。 */ () => {
  it('keeps only the keys that already exist on the target', /** 多余键会污染目标结构。 */ () => {
    const target = { a: 1, b: 2 };
    const source = { a: 10, b: 20, c: 30 };

    copyValueToTarget(target, source);

    expect(target).toEqual({ a: 10, b: 20 });
  });

  it('keeps the target value when the source lacks the key', /** 源对象缺键时不能把目标原有值清掉。 */ () => {
    const target = { a: 1, b: 2 };

    copyValueToTarget(target, { a: 10 });

    expect(target).toEqual({ a: 10, b: 2 });
  });

  it('does not add keys that the source introduces', /** 目标对象的键集合是白名单。 */ () => {
    const target: Record<string, number> = { a: 1 };

    copyValueToTarget(target, { extra: 5 });

    expect(Object.keys(target)).toEqual(['a']);
  });
});

describe('groupBy', /** 按字段值把数组分组，字段值统一转成字符串作键。 */ () => {
  it('groups items by the given field', /** 相同字段值的元素进入同一组。 */ () => {
    const rows = [
      { dept: 'tech', name: 'a' },
      { dept: 'hr', name: 'b' },
      { dept: 'tech', name: 'c' },
    ];

    expect(groupBy(rows, 'dept')).toEqual({
      hr: [{ dept: 'hr', name: 'b' }],
      tech: [
        { dept: 'tech', name: 'a' },
        { dept: 'tech', name: 'c' },
      ],
    });
  });

  it('buckets items without the field under undefined', /** 缺字段的元素不能被丢弃。 */ () => {
    const rows = [{ name: 'a' } as { dept?: string; name: string }];

    expect(Object.keys(groupBy(rows, 'dept'))).toEqual(['undefined']);
  });

  it('converts numeric field values to string keys', /** 键统一为字符串，便于直接索引。 */ () => {
    const rows = [
      { level: 1, name: 'a' },
      { level: 2, name: 'b' },
    ];

    expect(Object.keys(groupBy(rows, 'level'))).toEqual(['1', '2']);
  });

  it('returns an empty object for an empty array', /** 空输入没有分组。 */ () => {
    expect(groupBy([], 'dept')).toEqual({});
  });
});

describe('jsonParse', /** 解析失败时回退到原字符串，并给出可定位的告警。 */ () => {
  afterEach(
    /** 恢复真实控制台，避免告警 Spy 影响其它用例。 */ () => {
      vi.restoreAllMocks();
    },
  );

  it('parses a valid JSON object', /** 合法 JSON 必须解析成对象。 */ () => {
    expect(jsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('falls back to the original string and warns', /** 解析失败不能抛错，否则会中断整批数据处理。 */ () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 不真正打印告警，只让 Spy 记录调用。 */ () => {});

    expect(jsonParse('not json')).toBe('not json');
    expect(warn).toHaveBeenCalledWith('str[not json] 不是一个 JSON 字符串');
  });
});
