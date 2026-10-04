/**
 * 表格必填校验类名生成器的真实行为回归。
 *
 * vxe-table 依据返回的类名给单元格加红框：开关关闭时必须一律放行，开关打开后
 * 内置 `required` 规则对数量列要求大于 0 的数值、其余字段只要求非空，
 * 自定义规则按调用方函数判定；返回空串表示通过，否则返回错误样式类名。
 */
import { ref } from 'vue';

import { describe, expect, it } from 'vitest';

import {
  createCustomValidation,
  createRequiredValidation,
  createValidationClassName,
} from '../validation';

describe('表格必填校验类名', /** 校验结果直接决定单元格是否显示错误样式。 */ () => {
  it('校验开关关闭或缺失时一律放行', /** 不做必填校验的表格不能被误标红框。 */ () => {
    const disabled = createRequiredValidation(ref(false), 'name');

    expect(disabled({ row: { name: '' } })).toBe('');
    expect(disabled({ row: {} })).toBe('');
    expect(createRequiredValidation(undefined, 'name')({ row: {} })).toBe('');
  });

  it('必填字段非空才通过', /** 空串、0 与缺失字段都视为未填写。 */ () => {
    const className = createRequiredValidation(ref(true), 'name');

    expect(className({ row: { name: '研发部' } })).toBe('');
    expect(className({ row: { name: '0' } })).toBe('');
    expect(className({ row: { name: '' } })).toBe('required-field-error');
    expect(className({ row: { name: 0 } })).toBe('required-field-error');
    expect(className({ row: { name: false } })).toBe('required-field-error');
    expect(className({ row: {} })).toBe('required-field-error');
  });

  it('数量列要求大于 0 的数值', /** 数量为 0 或非法文本都不算填写有效数量。 */ () => {
    const className = createRequiredValidation(ref(true), 'count');

    expect(className({ row: { count: 1 } })).toBe('');
    expect(className({ row: { count: '2' } })).toBe('');
    expect(className({ row: { count: 0 } })).toBe('required-field-error');
    expect(className({ row: { count: '0' } })).toBe('required-field-error');
    expect(className({ row: { count: 'abc' } })).toBe('required-field-error');
    expect(className({ row: {} })).toBe('required-field-error');
  });

  it('自定义规则按调用方函数返回值判定', /** 自定义校验必须拿到当前行数据，返回 false 才标红。 */ () => {
    const className = createCustomValidation(
      ref(true),
      /** 行内存在禁用标记时视为通过。 */ (row) =>
        Boolean((row as { disabled?: boolean }).disabled),
    );

    expect(className({ row: { disabled: true } })).toBe('');
    expect(className({ row: {} })).toBe('required-field-error');
  });

  it('未知规则字符串按通过处理', /** 非 required 的内置规则不在本函数判定范围，不能误标红框。 */ () => {
    const className = createValidationClassName(ref(true), 'name', 'max:10');

    expect(className({ row: { name: '' } })).toBe('');
  });
});
