/** 树组件缺省属性工厂测试：验证缺省口径稳定，且每次调用返回独立数组避免多实例互相污染。 */
import { describe, expect, it } from 'vitest';

import { treePropsDefaults } from './types';

describe('treePropsDefaults', /** 调用点直接展开默认值，必须保证结构稳定且默认数组不共享引用。 */ () => {
  it('提供与 TreeProps 对齐的缺省项', /** 缺省项决定组件在未传属性时的行为，字段缺失会让渲染层读到 undefined。 */ () => {
    expect(treePropsDefaults()).toEqual({
      allowClear: false,
      autoCheckParent: true,
      bordered: false,
      checkStrictly: false,
      childrenField: 'children',
      defaultExpandedKeys: expect.any(Function),
      defaultExpandedLevel: 0,
      disabled: false,
      disabledField: 'disabled',
      iconField: 'icon',
      labelField: 'label',
      multiple: false,
      showIcon: true,
      transition: true,
      valueField: 'value',
    });
  });

  it('defaultExpandedKeys 每次返回空数组而不是同一引用', /** 共享数组会让多个树实例互相污染展开状态，这是该工厂存在的业务原因。 */ () => {
    const first = treePropsDefaults().defaultExpandedKeys;
    const second = treePropsDefaults().defaultExpandedKeys;

    expect(first()).toEqual([]);
    expect(first).not.toBe(second);
    expect(first()).not.toBe(first());
  });

  it('defaultExpandedKeys 返回的数组可被调用方安全修改', /** 默认值必须是调用方独占的可变数组，否则首棵树展开时会改动其他实例的默认值。 */ () => {
    const keys = treePropsDefaults().defaultExpandedKeys;

    keys().push('node-1');

    expect(keys()).toEqual([]);
  });

  it('兄弟字段名保持后端 treeData 的通用口径', /** 值、标签与子级字段名必须与通用树数据约定一致。 */ () => {
    const defaults = treePropsDefaults();

    expect(defaults.valueField).toBe('value');
    expect(defaults.labelField).toBe('label');
    expect(defaults.childrenField).toBe('children');
    expect(defaults.disabledField).toBe('disabled');
  });
});
