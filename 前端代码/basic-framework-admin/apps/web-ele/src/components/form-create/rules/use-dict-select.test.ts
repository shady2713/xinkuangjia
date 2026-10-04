/**
 * 字典选择器设计器规则（components/form-create/rules/use-dict-select）真实行为回归。
 *
 * 该规则与通用选择器规则的关键差别是挂载时异步拉取字典类型列表填充"字典类型"下拉：
 * 接口失败或返回空集合时必须保持空下拉而不是写入 undefined，返回数据必须按 name/type
 * 映射成下拉的 label/value，否则设计器会显示空白选项或把字典类型写成对象。
 * 用例挂载真实组件以触发 onMounted，只替换字典接口边界，规则生成与属性面板组装全部
 * 使用真实实现。
 */
import type {
  FormCreatePropsContext,
  FormCreatePropsRule,
} from '#/components/form-create/typing';

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSimpleDictTypeList } from '#/api/core/dict';
import { selectRule } from '#/components/form-create/rules/data';

import { useDictSelectRule } from './use-dict-select';

/** 字典选择器的组件名，同时是设计器注册名与属性面板语言键的一段。 */
const DICT_SELECT_NAME = 'DictSelect';

vi.mock(
  '#/api/core/dict',
  /** 只替换字典类型列表的网络边界，规则自身的映射与兜底逻辑保持真实实现。 */ () => ({
    getSimpleDictTypeList: vi.fn(),
  }),
);

/** 最近一次挂载中被测规则返回的注册项；由宿主组件在 setup 中赋值。 */
let registration: ReturnType<typeof useDictSelectRule> | undefined;

/**
 * 宿主组件：在真实组件上下文中调用被测规则，使 onMounted 与真实生命周期一致。
 */
const Host = defineComponent({
  name: 'DictSelectRuleHost',
  /**
   * 调用被测规则并渲染定位节点。
   * @returns 渲染宿主占位节点的渲染函数。
   */
  setup() {
    registration = useDictSelectRule();
    return /** 输出可定位节点，便于断言规则已进入真实组件树。 */ () =>
      h('div', { 'data-test': 'dict-select-host' });
  },
});

/**
 * 挂载宿主组件并等待字典类型列表加载完成。
 * @param types 字典接口返回的类型列表；undefined 表示接口没有返回数据。
 * @throws Error 组件未调用被测规则时抛出，避免用例静默地什么都不验证。
 */
async function mountRule(types?: unknown) {
  vi.mocked(getSimpleDictTypeList).mockResolvedValue(types as never);
  const wrapper = mount(Host);
  await flushPromises();
  if (!registration) {
    throw new Error('宿主组件未调用字典选择器规则');
  }
  return { registration, wrapper };
}

/**
 * 构造设计器上下文。
 * @returns 含 t 翻译函数的设计器上下文，翻译结果按前缀回显语言键。
 */
function propsContext(): FormCreatePropsContext {
  return {
    /** 把语言键回显成带前缀的译文，便于核对请求的键。 */
    t: (message: string) => `译文:${message}`,
  };
}

/**
 * 构造语言包缺键的设计器上下文。
 * @returns 含 t 翻译函数的设计器上下文，翻译结果为空串以核对中文兜底文案。
 */
function fallbackContext(): FormCreatePropsContext {
  return {
    /** 模拟语言包缺键：翻译结果为空串。 */
    t: () => '',
  };
}

/**
 * 按属性名取出属性面板配置行。
 * @param rows 属性面板返回的配置行数组。
 * @param field 目标控件绑定的属性名。
 * @returns 命中的配置行。
 * @throws Error 属性名不存在时抛出，避免用例静默地什么都不验证。
 */
function rowByField(rows: FormCreatePropsRule[], field: string) {
  const row = rows.find(
    /** 按属性名匹配配置行。 */ (item) => item.field === field,
  );
  if (!row) {
    throw new Error(`属性面板缺少配置行：${field}`);
  }
  return row;
}

beforeEach(
  /** 清空接口替身的调用记录，避免上一例结果影响断言。 */ () => {
    vi.clearAllMocks();
    registration = undefined;
  },
);

describe('字典选择器注册项', /** 注册项字段是设计器识别组件来源、图标与名称的契约。 */ () => {
  it('透传图标、名称与标签', /** 图标或名称写错会让设计器面板显示错误的组件条目。 */ async () => {
    const { registration: rule } = await mountRule([]);

    expect(rule.icon).toBe('icon-descriptions');
    expect(rule.label).toBe('字典选择器');
    expect(rule.name).toBe(DICT_SELECT_NAME);
  });

  it('生成字段名唯一、按 model-value 绑定的规则', /** 字段名重复会让同一表单的两个字典选择器互相覆盖取值。 */ async () => {
    const { registration: rule } = await mountRule([]);
    const generated = rule.rule();

    expect(generated.type).toBe(DICT_SELECT_NAME);
    expect(generated.title).toBe('字典选择器');
    expect(generated.info).toBe('');
    expect(generated.$required).toBe(false);
    expect(generated.modelField).toBe('model-value');
    expect(generated.field).toMatch(/^[\da-f]{32}$/u);
    expect(generated.field).not.toBe(rule.rule().field);
  });
});

describe('字典类型下拉加载', /** 下拉数据决定设计器里能否选到字典类型，映射或兜底写错会选错字典。 */ () => {
  it('按 name/type 映射接口返回的字典类型', /** 映射字段写错会让下拉显示空白选项或把整条记录当作取值。 */ async () => {
    const { registration: rule } = await mountRule([
      { name: '用户性别', type: 'system_user_sex' },
      { name: '通用状态', type: 'common_status' },
    ]);
    // 语言包缺键时保留 schema 中的中文兜底文案，这里用空翻译核对兜底后的真实展示内容。
    const rows = rule.props(DICT_SELECT_NAME, fallbackContext());

    expect(rowByField(rows, 'dictType')).toMatchObject({
      field: 'dictType',
      options: [
        { label: '用户性别', value: 'system_user_sex' },
        { label: '通用状态', value: 'common_status' },
      ],
      title: '字典类型',
      type: 'select',
      value: '',
    });
  });

  it('接口返回空集合时保持空下拉', /** 空集合写入 undefined 会让面板下拉报错或显示脏数据。 */ async () => {
    const { registration: rule } = await mountRule([]);
    const rows = rule.props(DICT_SELECT_NAME, propsContext());

    expect(rowByField(rows, 'dictType').options).toEqual([]);
  });

  it('接口没有返回数据时保持空下拉', /** 接口异常返回空值属于真实边界，不能把 undefined 当作选项列表。 */ async () => {
    const { registration: rule } = await mountRule(undefined);
    const rows = rule.props(DICT_SELECT_NAME, propsContext());

    expect(rowByField(rows, 'dictType').options).toEqual([]);
  });
});

describe('字典选择器属性面板', /** props() 决定面板展示的配置行、默认值与文案，直接面向使用者。 */ () => {
  it('必填行在前，字典与值类型行居中，通用选择行在后', /** 顺序变化会让设计器面板布局与既有习惯不一致。 */ async () => {
    const { registration: rule } = await mountRule([]);
    const rows = rule.props(DICT_SELECT_NAME, propsContext());

    expect(
      rows.map(
        /** 取出配置行的属性名，用于核对面板顺序。 */ (row) => row.field,
      ),
    ).toEqual([
      'formCreate$required',
      'dictType',
      'valueType',
      ...selectRule.map(
        /** 取出共享选择器规则声明的属性名作为期望顺序。 */ (row) => row.field,
      ),
    ]);
  });

  it('值类型固定三档并默认字符串', /** 少了布尔档会让布尔型字典无法正确回显，默认档写错会改变表单取值类型。 */ async () => {
    const { registration: rule } = await mountRule([]);
    const rows = rule.props(DICT_SELECT_NAME, fallbackContext());

    expect(rowByField(rows, 'valueType')).toMatchObject({
      options: [
        { label: '数字', value: 'int' },
        { label: '字符串', value: 'str' },
        { label: '布尔值', value: 'bool' },
      ],
      title: '字典值类型',
      type: 'select',
      value: 'str',
    });
  });

  it('按组件名与属性名请求翻译文案', /** 语言键前缀写错会让整块属性面板显示成键名。 */ async () => {
    const translate = vi.fn(
      /** 记录并回显被请求的语言键。 */ (message: string) => `译文:${message}`,
    );
    const { registration: rule } = await mountRule([]);
    const rows = rule.props('IgnoredName', { t: translate });

    expect(rowByField(rows, 'formCreate$required').title).toBe(
      '译文:props.required',
    );
    expect(rowByField(rows, 'dictType').title).toBe(
      `译文:components.${DICT_SELECT_NAME}.props.dictType`,
    );
    expect(translate).toHaveBeenCalledWith(
      `components.${DICT_SELECT_NAME}.props.valueType`,
    );
  });

  it('挂载时只请求一次字典类型列表', /** 面板每次展开都重新请求会放大接口压力并让下拉数据抖动。 */ async () => {
    const { registration: rule } = await mountRule([
      { name: '用户性别', type: 'system_user_sex' },
    ]);

    rule.props(DICT_SELECT_NAME, propsContext());
    rule.props(DICT_SELECT_NAME, propsContext());

    expect(getSimpleDictTypeList).toHaveBeenCalledTimes(1);
  });
});
