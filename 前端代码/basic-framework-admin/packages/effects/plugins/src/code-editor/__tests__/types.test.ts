/**
 * 代码编辑器模式枚举（code-editor/types.ts）的运行时契约回归。
 *
 * 该模块只导出运行时枚举与纯类型：`MODE` 是 TypeScript 枚举，编译后产生真实对象，
 * 其取值直接作为 CodeMirror 的 mode 传入，写成错误的 MIME 会让高亮与格式化失效。
 * 用例断言枚举的真实取值、反向映射与成员集合，纯类型部分由类型检查保证。
 */
import { describe, expect, it } from 'vitest';

import { MODE } from '../types';

describe('模式枚举运行时取值（MODE）', /** CodeMirror 模式名的真实取值。 */ () => {
  it('每个成员对应固定的编辑器模式名', /** 模式名是第三方编辑器的协议值，改名会让高亮与 JSON 格式化失效。 */ () => {
    expect(MODE.HTML).toBe('htmlmixed');
    expect(MODE.JS).toBe('javascript');
    expect(MODE.JSON).toBe('application/json');
    expect(MODE.VUE).toBe('vue');
  });

  it('枚举成员集合固定', /** 新增或删除成员都会改变编辑器可选模式，必须显式核对。 */ () => {
    expect(Object.keys(MODE).toSorted()).toEqual(['HTML', 'JS', 'JSON', 'VUE']);
  });

  it('数字枚举才产生反向映射，本枚举不产生', /** 字符串枚举没有值到名的反向映射，误用会让模式名被当成数字索引。 */ () => {
    expect('htmlmixed' in MODE).toBe(false);
    expect(
      Object.values(MODE).every(
        /** 每个枚举值都必须是可直接交给编辑器的字符串。 */ (value) =>
          typeof value === 'string',
      ),
    ).toBe(true);
  });

  it('取值互不相同', /** 两个模式共用同一个模式名会让其中一种语言无法正确高亮。 */ () => {
    const values = Object.values(MODE);

    expect(new Set(values).size).toBe(values.length);
  });
});
