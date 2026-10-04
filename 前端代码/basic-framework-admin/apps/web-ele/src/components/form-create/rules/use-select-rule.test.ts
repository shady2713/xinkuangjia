/**
 * 通用选择器设计器规则（components/form-create/rules/use-select-rule）真实行为回归。
 *
 * 表单设计器用它生成"下拉框/单选框/多选框"等选择类组件的注册项：rule() 决定画布上
 * 生成的字段名与默认属性，props() 决定右侧属性面板展示哪些配置行以及中文文案。
 * 字段名重复会让同一表单的两个控件互相覆盖取值，默认值判断错误会把 undefined
 * 写进组件属性而覆盖组件自身默认值，属性面板文案未国际化会显示成语言键。
 * 用例只使用真实的 helpers 与 selectRule，不替换任何被测实现。
 */
import type {
  FormCreatePropsContext,
  FormCreatePropsRule,
} from '#/components/form-create/typing';

import { describe, expect, it, vi } from 'vitest';

import { selectRule } from '#/components/form-create/rules/data';

import { useSelectRule } from './use-select-rule';

/** 选择器组件名，与真实业务调用保持一致。 */
const SELECT_NAME = 'Select';

/**
 * 构造规则配置，字段与业务侧调用形式一致。
 * @param props 属性面板的额外配置行；省略时表示该组件没有自定义属性。
 * @returns 可直接交给 useSelectRule 的配置对象。
 */
function selectOption(props?: FormCreatePropsRule[]) {
  return {
    event: [{ name: 'change' }],
    icon: 'icon-select',
    label: '下拉选择器',
    name: SELECT_NAME,
    props,
  };
}

/**
 * 构造设计器上下文，翻译函数按前缀回显以便核对语言键。
 * @returns 含 t 翻译函数的设计器上下文。
 */
function propsContext(): FormCreatePropsContext {
  return {
    /** 把语言键回显成带前缀的译文，便于核对请求的键。 */
    t: (message: string) => `译文:${message}`,
  };
}

describe('选择器规则生成', /** rule() 的字段名与默认属性决定画布上控件的真实取值。 */ () => {
  it('按配置生成字段名唯一的规则', /** 字段名重复会让同一表单的两个控件互相覆盖取值。 */ () => {
    const rule = useSelectRule(selectOption()).rule();
    const another = useSelectRule(selectOption()).rule();

    expect(rule.type).toBe(SELECT_NAME);
    expect(rule.title).toBe('下拉选择器');
    expect(rule.info).toBe('');
    expect(rule.$required).toBe(false);
    expect(rule.field).toMatch(/^[\da-f]{32}$/u);
    expect(rule.field).not.toBe(another.field);
  });

  it('没有自定义属性时不写 props 字段', /** 空 props 会覆盖组件自身默认属性，导致控件行为变化。 */ () => {
    const rule = useSelectRule(selectOption()).rule();

    expect(rule.props).toBeUndefined();
  });

  it('把有默认值的属性写进 props', /** 默认值丢失会让设计器配置的控件回到组件初始状态。 */ () => {
    const rule = useSelectRule(
      selectOption([
        { field: 'multiple', title: '是否多选', value: true },
        { field: 'placeholder', title: '占位符', value: '请选择' },
      ]),
    ).rule();

    expect(rule.props).toEqual({ multiple: true, placeholder: '请选择' });
  });

  it('跳过未填默认值与缺字段的配置行', /** 把 undefined 写进 props 会覆盖组件自身默认值。 */ () => {
    const rule = useSelectRule(
      selectOption([
        { field: 'multiple', title: '是否多选' },
        { field: '', title: '无字段行', value: 'x' },
        { field: 'disabled', title: '是否禁用', value: false },
      ]),
    ).rule();

    expect(rule.props).toEqual({ disabled: false });
  });

  it('空属性数组不产生 props 字段', /** 空数组同样不应写入 props，避免生成多余的空属性对象。 */ () => {
    const rule = useSelectRule(selectOption([])).rule();

    expect(rule.props).toBeUndefined();
  });
});

describe('选择器属性面板', /** props() 决定面板展示哪些配置行及其文案，直接面向使用者。 */ () => {
  it('必填行在前、自定义行居中、通用选择行在后', /** 顺序变化会让设计器面板布局与既有习惯不一致。 */ () => {
    const extra: FormCreatePropsRule[] = [
      { field: 'dictType', title: '字典类型' },
    ];
    const rows = useSelectRule(selectOption(extra)).props(
      SELECT_NAME,
      propsContext(),
    );

    expect(rows).toHaveLength(extra.length + selectRule.length + 1);
    expect(rows[0]?.field).toBe('formCreate$required');
    expect(rows[1]?.field).toBe('dictType');
    expect(
      rows
        .slice(2)
        .map(/** 取出通用选择行的字段名用于顺序核对。 */ (row) => row.field),
    ).toEqual(
      selectRule.map(
        /** 取出共享规则声明的字段名作为期望顺序。 */ (row) => row.field,
      ),
    );
  });

  it('按组件名与字段名请求翻译文案', /** 语言键前缀写错会让属性面板整列显示成键名。 */ () => {
    const translate = vi.fn(
      /** 记录并回显被请求的语言键。 */
      (message: string) => `译文:${message}`,
    );
    const option = selectOption([{ field: 'dictType', title: '字典类型' }]);
    const rows = useSelectRule(option).props('IgnoredName', {
      t: translate,
    });

    expect(rows[0]?.title).toBe('译文:props.required');
    expect(rows[1]?.title).toBe(
      `译文:components.${SELECT_NAME}.props.dictType`,
    );
    expect(translate).toHaveBeenCalledWith('props.required');
    expect(translate).toHaveBeenCalledWith(
      `components.${SELECT_NAME}.props.placeholder`,
    );
  });

  it('翻译缺失时保留中文兜底文案', /** 语言包缺键时面板仍要显示可读中文，不能变成空标题。 */ () => {
    const rows = useSelectRule(
      selectOption([{ field: 'dictType', title: '字典类型' }]),
    ).props(SELECT_NAME, {
      /** 模拟语言包缺键：翻译结果为空串。 */
      t: () => '',
    });

    expect(rows[1]?.title).toBe('字典类型');
    expect(rows[0]?.title).toBe('是否必填');
  });

  it('缺少自定义属性时补成空数组并保留通用行', /** 未初始化就展开会让设计器面板缺少全部通用配置行。 */ () => {
    const option = selectOption();
    const rows = useSelectRule(option).props(SELECT_NAME, propsContext());

    expect(option.props).toEqual([]);
    expect(rows).toHaveLength(selectRule.length + 1);
  });

  it('多次调用不会污染共享的通用规则', /** 共享数组被就地翻译后，其它选择器组件的面板会沿用上一次的文案。 */ () => {
    const first = useSelectRule(selectOption()).props(SELECT_NAME, {
      /** 第一轮翻译带独立前缀，便于识别是否被第二轮覆盖。 */
      t: (message: string) => `第一:${message}`,
    });
    const second = useSelectRule(selectOption()).props(SELECT_NAME, {
      /** 第二轮翻译带另一前缀，用于发现共享数组被就地改写。 */
      t: (message: string) => `第二:${message}`,
    });

    expect(first[1]?.title).toContain('第一:');
    expect(second[1]?.title).toContain('第二:');
  });
});

describe('选择器注册项结构', /** 注册项字段是设计器识别组件来源与图标契约。 */ () => {
  it('透传图标、名称与事件配置', /** 图标或事件丢失会让设计器无法拖拽或无法绑定事件。 */ () => {
    const option = selectOption();
    const registration = useSelectRule(option);

    expect(registration.icon).toBe('icon-select');
    expect(registration.label).toBe('下拉选择器');
    expect(registration.name).toBe(SELECT_NAME);
    expect(registration.event).toBe(option.event);
  });
});
