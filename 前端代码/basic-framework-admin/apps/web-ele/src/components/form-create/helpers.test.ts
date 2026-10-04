/**
 * form-create 设计器属性面板公共工具（components/form-create/helpers）的真实行为回归。
 *
 * 这两条工具决定设计器属性面板显示什么：必填开关行的 field 被国际化流程识别，
 * `_optionType` 是 form-create 自身的组件类型行，不能被业务语言键覆盖；语言包缺键时
 * 必须保留原中文 title，而不是把面板文案替换成裸 key。用例直接调用真实函数并核对
 * 就地修改后的对象内容与引用。
 */
import { describe, expect, it, vi } from 'vitest';

import { localeProps, makeRequiredRule } from './helpers';

describe('makeRequiredRule 必填开关行', /** 该行的 field 是国际化流程识别必填项的固定标识，改动会让面板文案错位。 */ () => {
  it('返回 form-create 必填控件约定的字段与文案', /** type 决定面板控件类型，field 决定语言键，两者都不能漂移。 */ () => {
    expect(makeRequiredRule()).toEqual({
      field: 'formCreate$required',
      title: '是否必填',
      type: 'Required',
    });
  });

  it('每次调用返回独立对象', /** 复用同一对象会让面板之间互相覆盖文案。 */ () => {
    const first = makeRequiredRule();
    const second = makeRequiredRule();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe('localeProps 属性面板文案国际化', /** 面板文案由语言包提供，缺键时必须回退原中文而不是显示 key。 */ () => {
  it('必填行使用 props.required 语言键', /** 必填开关必须与其它必填项共用同一条语言键。 */ () => {
    const translate = vi.fn(
      /** 固定返回必填文案，便于核对实际请求的语言键。 */ () => '必填项',
    );

    const rules = localeProps(translate, 'Input', [makeRequiredRule()]);

    expect(translate).toHaveBeenCalledWith('props.required');
    expect(rules[0]?.title).toBe('必填项');
  });

  it('普通字段按 components.前缀.字段 拼接语言键', /** 键名拼接规则决定组件属性文案能否命中语言包。 */ () => {
    const translate = vi.fn(
      /** 按收到的语言键回显，便于核对拼接结果。 */ (key: string) =>
        `译:${key}`,
    );

    const rules = localeProps(translate, 'Select', [
      { field: 'placeholder', title: '占位提示', type: 'Input' },
    ]);

    expect(translate).toHaveBeenCalledWith('components.Select.placeholder');
    expect(rules[0]?.title).toBe('译:components.Select.placeholder');
  });

  it('组件类型行不参与翻译', /** `_optionType` 属于 form-create 自身控件，翻译会把它覆盖成无意义的 key。 */ () => {
    const translate = vi.fn(
      /** 任何调用都视为越界翻译，返回可识别文案便于断言。 */ () => '不应出现',
    );

    const rules = localeProps(translate, 'Input', [
      { field: '_optionType', title: '组件类型', type: 'Select' },
    ]);

    expect(translate).not.toHaveBeenCalled();
    expect(rules[0]?.title).toBe('组件类型');
  });

  it('语言包缺键时保留原中文文案', /** 缺键回显空串或 key 时不能让面板显示裸键名。 */ () => {
    const translate = vi.fn(/** 模拟 vue-i18n 缺键时返回空串。 */ () => '');

    const rules = localeProps(translate, 'Input', [
      { field: 'label', title: '标签', type: 'Input' },
      makeRequiredRule(),
    ]);

    expect(
      rules.map(/** 取出面板实际展示的文案。 */ (rule) => rule.title),
    ).toEqual(['标签', '是否必填']);
  });

  it('字段名为空的行原样保留', /** 没有 field 的分隔行或说明行不能被翻译流程改写。 */ () => {
    const translate = vi.fn(/** 任何调用都视为越界翻译。 */ () => '不应出现');

    const rules = localeProps(translate, 'Input', [
      { field: '', title: '分组标题', type: 'Divider' },
    ]);

    expect(translate).not.toHaveBeenCalled();
    expect(rules[0]?.title).toBe('分组标题');
  });

  it('就地修改并返回同一批对象引用', /** form-create 依赖原对象引用读取面板配置，重建对象会丢失其它控件字段。 */ () => {
    const required = makeRequiredRule();
    const input = { field: 'label', title: '标签', type: 'Input' };
    const translate = vi.fn(
      /** 按语言键回显，便于核对就地修改结果。 */ (key: string) => `译:${key}`,
    );

    const rules = localeProps(translate, 'Input', [required, input]);

    expect(rules).toHaveLength(2);
    expect(rules[0]).toBe(required);
    expect(rules[1]).toBe(input);
    expect(input.title).toBe('译:components.Input.label');
  });

  it('空规则列表返回空数组', /** 无属性面板配置时不能凭空产生配置行。 */ () => {
    const translate = vi.fn(
      /** 空输入不应触发任何翻译调用。 */ () => '不应出现',
    );

    expect(localeProps(translate, 'Input', [])).toEqual([]);
    expect(translate).not.toHaveBeenCalled();
  });
});
