/**
 * 表单项渲染（form-ui 的 form-render/form-field.vue）边界分支真实回归。
 *
 * 表单项决定每个 schema 字段最终渲染成什么控件、带哪些限制、如何回写取值：未注册组件不告警
 * 会让页面静默空白，必填判定漏掉组合规则会让星号与校验不一致，数字与文本默认限制缺失会让
 * 用户可以录入越界数据，绑定事件解析错会把事件对象当成字段值写进表单，自动聚焦与控件引用
 * 未按契约执行会让页面焦点错位或在销毁后仍写回失效引用。用例挂载真实表单容器与真实表单项，
 * 只把具体控件替换成可断言的探针组件，规则解析、属性合并、事件解包与生命周期全部真实执行。
 */
import type { Component } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { defineRule, Field } from 'vee-validate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { COMPONENT_BIND_EVENT_MAP, COMPONENT_MAP } from '../src/config';
import { Form } from '../src/form-render';
import { useVbenForm } from '../src/use-form';
import { provideComponentRefMap } from '../src/use-form-context';

// 字符串规则名在生产由 setupVbenForm 的 defineRules 统一注册，这里按同一入口补齐用例用到的规则。
defineRule(
  'required',
  /** 必填规则：非空即通过，用于核对组合规则中的必填识别。 */ (
    value: unknown,
  ) => value !== '' && value !== null && value !== undefined,
);
defineRule(
  'min',
  /**
   * 最小长度规则：字符串长度不足时返回失败文案。
   * @param value 当前字段值。
   * @param params 规则参数，字符串规则会以数组形式传入。
   * @returns 通过时返回 true，否则返回失败文案。
   */
  (value: unknown, params: unknown) => {
    const limit = Array.isArray(params) ? Number(params[0]) : Number(params);
    return String(value ?? '').length >= limit || `至少 ${limit} 个字符`;
  },
);
defineRule(
  'customRequired',
  /** 命名以 Required 结尾的自定义必填规则，用于核对组合规则的必填识别。 */ () =>
    true,
);

/** 控件 change 回调签名：接收事件对象或控件直接取值。 */
type ChangeHandler = (event: unknown) => void;

/** 自动聚焦探针记录的 focus 调用；每例开始前清空。 */
const focusCalls = vi.fn();

/** 自动聚焦探针控件：真实暴露 focus 方法，用于验证聚焦落到控件实例而不是空引用。 */
const FocusProbe = defineComponent({
  name: 'FocusProbe',
  /**
   * 暴露 focus 方法并渲染最小输入元素。
   * @param _props 未使用的控件属性。
   * @param context 组件上下文，用于暴露 focus 方法。
   * @param context.expose 暴露实例方法的函数。
   * @returns 渲染输入元素的渲染函数。
   */
  setup(_props, { expose }) {
    expose({ focus: focusCalls });
    return /** 渲染可定位的输入元素。 */ () =>
      h('input', { 'data-test': 'focus-probe' });
  },
});

/** 文本类探针控件：把收到的控件属性真实落到原生输入框，便于断言默认限制。 */
const TextProbe = defineComponent({
  name: 'TextProbe',
  inheritAttrs: false,
  /**
   * 把收到的全部属性渲染到原生输入框。
   * @param _props 未声明的控件属性。
   * @param context 组件上下文，用于读取透传属性。
   * @param context.attrs 表单项透传的控件属性。
   * @returns 渲染输入元素的渲染函数。
   */
  setup(_props, { attrs }) {
    return /** 把属性真实落到原生输入框。 */ () =>
      h('input', { ...attrs, 'data-test': 'text-probe' });
  },
});

/** 取值探针控件：真实声明 modelValue 并渲染成可断言属性，用于核对字段初始值。 */
const ValueProbe = defineComponent({
  name: 'ValueProbe',
  props: {
    /** 表单项注入的字段取值，未声明时保持 undefined 以便核对空值口径。 */
    modelValue: { default: undefined },
  },
  /**
   * 把当前取值渲染成可断言属性。
   * @param props 表单项注入的取值属性。
   * @returns 渲染取值节点的渲染函数。
   */
  setup(props) {
    return /** 把当前取值渲染成可断言属性。 */ () =>
      h('span', {
        'data-test': 'value-probe',
        'data-value': String(props.modelValue),
      });
  },
});

/** 插槽探针控件：真实渲染默认插槽，用于验证 renderComponentContent 的渲染函数落地。 */
const SlotProbe = defineComponent({
  name: 'SlotProbe',
  /**
   * 渲染默认插槽内容。
   * @param _props 未声明的控件属性。
   * @param context 组件上下文，用于取用默认插槽。
   * @param context.slots 表单项注入的插槽表。
   * @returns 渲染插槽内容的渲染函数。
   */
  setup(_props, { slots }) {
    return /** 渲染控件默认插槽内容。 */ () =>
      h('div', { 'data-test': 'slot-probe' }, slots.default?.() ?? []);
  },
});

/** 勾选类探针控件：点击时把带 target 的事件对象交给表单，复现第三方控件的事件回传。 */
const CheckProbe = defineComponent({
  name: 'CheckProbe',
  inheritAttrs: false,
  /**
   * 渲染可点击按钮，并把当前取值与 change 回调状态暴露成可断言的属性。
   * @param _props 未声明的控件属性。
   * @param context 组件上下文，用于读取表单项注入的属性。
   * @param context.attrs 表单项透传的取值与事件回调。
   * @returns 渲染按钮的渲染函数。
   */
  setup(_props, { attrs }) {
    return /** 渲染可点击按钮并暴露取值与回调状态。 */ () =>
      h(
        'button',
        {
          'data-checked': String(attrs.checked),
          'data-has-change': String(typeof attrs.onChange === 'function'),
          'data-test': 'check-probe',
          /** 按 payload 声明把事件对象或普通取值交给表单项注入的 change 回调。 */
          onClick: /** 触发一次控件变更并回传取值。 */ () => {
            const handler = attrs.onChange as ChangeHandler | undefined;
            const mode = String(attrs.payload ?? 'checked');
            if (mode === 'plain') {
              handler?.('普通取值');
              return;
            }
            handler?.({
              /** 满足事件对象判定的最小方法。 */
              stopPropagation: () => {},
              target: mode === 'missing' ? {} : { checked: false },
            });
          },
        },
        String(attrs.checked),
      );
  },
});

/** 探针控件集合：用于容器属性方式的挂载，避免依赖共享组件表的当前状态。 */
const probeComponents = {
  CheckProbe,
  FocusProbe,
  SlotProbe,
  TextProbe,
  ValueProbe,
} as unknown as Record<string, Component>;

/** 已登记的共享组件表键；用例结束后按键还原。 */
const registeredComponentKeys: string[] = [];
/** 已登记的取值属性表键；用例结束后按键还原。 */
const registeredBindKeys: string[] = [];

/**
 * 按生产登记方式把探针写入共享组件表，使真实创建入口能解析到探针。
 * @param componentMap 组件名到探针控件的映射。
 * @param bindEventMap 组件名到取值属性名的映射，省略时不登记取值属性。
 */
function registerProbes(
  componentMap: Record<string, Component>,
  bindEventMap: Record<string, string> = {},
) {
  const componentTable = COMPONENT_MAP as unknown as Record<string, Component>;
  const bindTable = COMPONENT_BIND_EVENT_MAP as Record<string, string>;
  for (const [name, probe] of Object.entries(componentMap)) {
    if (!(name in componentTable)) {
      registeredComponentKeys.push(name);
    }
    componentTable[name] = probe;
  }
  for (const [name, propName] of Object.entries(bindEventMap)) {
    if (!(name in bindTable)) {
      registeredBindKeys.push(name);
    }
    bindTable[name] = propName;
  }
}

/** 还原本文件写入共享组件表的登记项，避免影响其他用例与其他测试文件。 */
function restoreProbes() {
  const componentTable = COMPONENT_MAP as unknown as Record<string, Component>;
  const bindTable = COMPONENT_BIND_EVENT_MAP as Record<string, string>;
  for (const name of registeredComponentKeys.splice(0)) {
    Reflect.deleteProperty(componentTable, name);
  }
  for (const name of registeredBindKeys.splice(0)) {
    Reflect.deleteProperty(bindTable, name);
  }
}

/**
 * 构造与真实消费方一致的宿主：先提供控件引用表，再渲染真实表单容器。
 * @param props 透传给表单容器的属性。
 * @param refMap 控件引用表，用于观察表单项挂载与卸载时的登记结果。
 * @returns 可直接挂载的宿主组件。
 */
function createHarness(
  props: Record<string, unknown>,
  refMap: Map<string, unknown> = new Map(),
) {
  return defineComponent({
    name: 'FormFieldHarness',
    /**
     * 提供表单项渲染必需的控件引用表上下文。
     * @returns 渲染真实表单容器的渲染函数，属性由宿主原样透传。
     */
    setup() {
      provideComponentRefMap(refMap);
      return /** 渲染真实表单容器并透传属性。 */ () =>
        h(Form, { componentMap: probeComponents, ...props });
    },
  });
}

/**
 * 用容器属性方式挂载表单并等待渲染收敛。
 * @param props 透传给表单容器的属性。
 * @returns 已挂载的组件包装器与控件引用表。
 */
async function mountForm(props: Record<string, unknown>) {
  const refMap = new Map<string, unknown>();
  const wrapper = mount(createHarness(props, refMap));
  await flushPromises();
  await flushPromises();
  return { refMap, wrapper };
}

/**
 * 用真实创建入口挂载表单，使默认值推导与表单上下文与生产一致。
 * @param options 表单属性，与 useVbenForm 的入参一致。
 * @returns 表单操作实例与已挂载的组件包装器。
 */
async function mountVbenForm(options: Record<string, unknown>) {
  const [FormComponent, formApi] = useVbenForm(
    options as Parameters<typeof useVbenForm>[0],
  );
  const wrapper = mount(FormComponent as Component);
  await flushPromises();
  await flushPromises();
  return { formApi, wrapper };
}

beforeEach(
  /** 清空探针调用记录，保证每例只观察自己的行为。 */ () => {
    vi.clearAllMocks();
  },
);

afterEach(
  /** 还原共享组件表登记，避免跨用例污染。 */ () => {
    restoreProbes();
  },
);

describe('字段组件解析', /** 组件解析决定字段能否渲染，失败必须可诊断而不是静默空白。 */ () => {
  it('组件名未注册时告警并保持表单项结构', /** 静默失败会让页面出现无法解释的空白字段。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 屏蔽真实告警输出，只保留调用记录。 */ () => {});

    const { wrapper } = await mountForm({
      schema: [
        {
          component: 'NotRegisteredWidget',
          fieldName: 'ghost',
          label: '未注册字段',
        },
      ],
    });

    expect(warn).toHaveBeenCalledWith(
      'Component NotRegisteredWidget is not registered',
    );
    expect(wrapper.text()).toContain('未注册字段');

    wrapper.unmount();
    warn.mockRestore();
  });

  it('组件以组件对象声明时直接渲染该对象', /** 业务需要用非注册组件时不能被字符串分支吞掉。 */ async () => {
    const { wrapper } = await mountForm({
      schema: [
        {
          component: TextProbe,
          componentProps: { placeholder: '对象组件' },
          fieldName: 'objectField',
          label: '对象组件字段',
        },
      ],
    });

    const input = wrapper.find('[data-test="text-probe"]');
    expect(input.exists()).toBe(true);
    expect(input.attributes('placeholder')).toBe('对象组件');

    wrapper.unmount();
  });
});

describe('必填标记判定', /** 必填标记与校验规则必须一致，否则用户不知道哪些字段必须填写。 */ () => {
  it('字符串组合规则中识别 required 与以 Required 结尾的规则', /** 组合规则漏判会让必填字段没有星号。 */ async () => {
    const { wrapper } = await mountForm({
      schema: [
        {
          component: 'TextProbe',
          fieldName: 'comboRequired',
          label: '组合必填',
          rules: 'required|min:1',
        },
        {
          component: 'TextProbe',
          fieldName: 'suffixRequired',
          label: '后缀必填',
          rules: 'customRequired',
        },
      ],
    });

    expect(wrapper.findAll('.form-is-required')).toHaveLength(2);

    wrapper.unmount();
  });

  it('仅格式校验的字符串规则不标记必填', /** 负对照：格式规则被当成必填会让可选字段强制必填。 */ async () => {
    const { wrapper } = await mountForm({
      schema: [
        {
          component: 'TextProbe',
          fieldName: 'formatOnly',
          label: '仅格式',
          rules: 'min:3',
        },
      ],
    });

    expect(wrapper.findAll('.form-is-required')).toHaveLength(0);
    expect(wrapper.find('[data-test="text-probe"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it('zod 默认值包装不取消必填并解出内层规则', /** 带默认值的必填字段被误判为可选会让提交绕过校验。 */ async () => {
    registerProbes({ ValueProbe });
    const { wrapper } = await mountVbenForm({
      schema: [
        {
          component: 'ValueProbe',
          fieldName: 'zodDefaultField',
          label: '带默认值',
          rules: z.string().default('默认值'),
        },
      ],
    });

    expect(wrapper.findAll('.form-is-required')).toHaveLength(1);
    expect(
      wrapper.find('[data-test="value-probe"]').attributes('data-value'),
    ).toBe('默认值');

    wrapper.unmount();
  });

  it('联动声明必填时解开可选包装并注册内层规则', /** 只解 ZodDefault 会让“可选包装 + 联动必填”的字段永远不校验。 */ async () => {
    registerProbes({ TextProbe });
    const { formApi, wrapper } = await mountVbenForm({
      schema: [
        {
          component: 'TextProbe',
          defaultValue: '初始值',
          fieldName: 'trigger',
          label: '触发字段',
        },
        {
          component: 'TextProbe',
          dependencies: {
            /** 始终要求该字段必填，用于驱动内层规则解包。 */
            required: () => true,
            triggerFields: ['trigger'],
          },
          fieldName: 'optionalWithRequired',
          label: '可选但必填',
          rules: z.string().optional(),
        },
      ],
    });

    expect(wrapper.findAll('.form-is-required')).toHaveLength(1);
    // 联动必填配合可选包装时，必须真正注册解包后的字符串规则：空值校验失败。
    await expect(formApi.validate()).resolves.toMatchObject({ valid: false });

    await formApi.setFieldValue('optionalWithRequired', '文本');
    await flushPromises();
    await flushPromises();

    // 负对照：填入合法字符串后校验通过，证明注册的是内层规则而不是未解包的包装。
    await expect(formApi.validate()).resolves.toMatchObject({ valid: true });

    wrapper.unmount();
  });
});

describe('控件默认限制', /** 默认限制补在页面未声明的位置，写错会覆盖业务范围或让用户可以越界录入。 */ () => {
  it('数字文本控件补齐 min、max 与 step', /** 数字字段没有默认范围会允许录入超范围数据。 */ async () => {
    const { wrapper } = await mountForm({
      componentMap: { Input: TextProbe },
      schema: [
        {
          component: 'Input',
          componentProps: { type: 'number' },
          fieldName: 'amount',
          label: '金额',
        },
      ],
    });

    const input = wrapper.find('[data-test="text-probe"]');
    expect(input.attributes('min')).toBe('0');
    expect(input.attributes('max')).toBe('999999999');
    expect(input.attributes('step')).toBe('1');

    wrapper.unmount();
  });

  it('页面已声明的数字范围优先于默认值', /** 默认范围覆盖业务限制会让百分比、置信度一类字段无法录入。 */ async () => {
    const { wrapper } = await mountForm({
      componentMap: { Input: TextProbe },
      schema: [
        {
          component: 'Input',
          componentProps: { max: 1, min: 0, step: 0.01, type: 'number' },
          fieldName: 'ratio',
          label: '比例',
        },
      ],
    });

    const input = wrapper.find('[data-test="text-probe"]');
    expect(input.attributes('min')).toBe('0');
    expect(input.attributes('max')).toBe('1');
    expect(input.attributes('step')).toBe('0.01');

    wrapper.unmount();
  });

  it('驼峰形式的长度上限同样触发字数统计', /** 只识别小写 maxlength 会让使用驼峰配置的页面丢失字数提示。 */ async () => {
    const { wrapper } = await mountForm({
      componentMap: { Input: TextProbe },
      schema: [
        {
          component: 'Input',
          componentProps: { maxLength: 20 },
          fieldName: 'camelLimited',
          label: '驼峰限长文本',
        },
      ],
    });

    expect(
      wrapper.find('[data-test="text-probe"]').attributes('showwordlimit'),
    ).toBe('true');

    wrapper.unmount();
  });

  it('已声明长度上限的文本框自动显示字数统计', /** 有上限但不显示字数会让用户无法判断还能输入多少。 */ async () => {
    const { wrapper } = await mountForm({
      componentMap: { Input: TextProbe },
      schema: [
        {
          component: 'Input',
          componentProps: { maxlength: 12 },
          fieldName: 'limited',
          label: '限长文本',
        },
      ],
    });

    expect(
      wrapper.find('[data-test="text-probe"]').attributes('showwordlimit'),
    ).toBe('true');

    wrapper.unmount();
  });
});

describe('函数式控件参数', /** 动态参数必须拿到真实表单值与表单实例，否则联动会失效。 */ () => {
  it('按当前表单值与表单实例计算控件参数并随值变化重算', /** 参数函数拿不到值或算了不重算都会让联动字段显示过期内容。 */ async () => {
    const resolveProps = vi.fn(
      /**
       * 用当前表单值生成占位文案。
       * @param values 当前表单值集合。
       * @param actions 当前表单上下文，用于验证实例确实被传入。
       * @returns 控件属性集合。
       */
      (values: Record<string, unknown>, actions: unknown) => ({
        'data-has-actions': String(Boolean(actions)),
        placeholder: String(values.source ?? ''),
      }),
    );
    registerProbes({ TextProbe });
    const { formApi, wrapper } = await mountVbenForm({
      schema: [
        {
          component: 'TextProbe',
          defaultValue: '初始值',
          fieldName: 'source',
          label: '来源',
        },
        {
          component: 'TextProbe',
          componentProps: resolveProps,
          fieldName: 'target',
          label: '目标',
        },
      ],
    });

    const target = wrapper.findAll('[data-test="text-probe"]')[1];
    expect(resolveProps).toHaveBeenCalled();
    expect(target?.attributes('placeholder')).toBe('初始值');
    expect(target?.attributes('data-has-actions')).toBe('true');

    await formApi.setFieldValue('source', '更新值');
    await flushPromises();
    await flushPromises();

    expect(
      wrapper.findAll('[data-test="text-probe"]')[1]?.attributes('placeholder'),
    ).toBe('更新值');

    wrapper.unmount();
  });

  it('缺少表单上下文时不调用参数函数并退化为空属性', /** 把 undefined 当表单实例传给业务函数会让渲染期直接崩溃。 */ async () => {
    const resolveProps = vi.fn(
      /** 返回带占位文案的属性，用于确认该函数在无表单上下文时不被调用。 */
      () => ({ placeholder: '不应出现' }),
    );

    const { wrapper } = await mountForm({
      schema: [
        {
          component: 'TextProbe',
          componentProps: resolveProps,
          fieldName: 'noForm',
          label: '无表单字段',
        },
      ],
    });

    expect(resolveProps).not.toHaveBeenCalled();
    expect(
      wrapper.find('[data-test="text-probe"]').attributes('placeholder'),
    ).toBeUndefined();

    wrapper.unmount();
  });
});

describe('取值绑定与事件解包', /** 第三方控件把事件对象或包装对象当作值回传，解包错误会把对象写进表单。 */ () => {
  it('事件对象形状的取值被还原为控件真实取值', /** 直接透传事件对象会让表单收到 target 而不是勾选状态。 */ async () => {
    registerProbes({ CheckProbe }, { CheckProbe: 'checked' });
    const { formApi, wrapper } = await mountVbenForm({
      commonConfig: { disabledOnChangeListener: false },
      schema: [
        {
          component: 'CheckProbe',
          defaultValue: {
            /** 满足事件对象判定的最小方法。 */
            stopPropagation: () => {},
            target: { checked: true },
          },
          fieldName: 'eventLike',
          label: '事件形状取值',
        },
      ],
    });

    const probe = wrapper.find('[data-test="check-probe"]');
    expect(probe.attributes('data-checked')).toBe('true');
    expect(probe.attributes('data-has-change')).toBe('true');

    await probe.trigger('click');
    await flushPromises();
    await flushPromises();

    await expect(formApi.getValues()).resolves.toEqual({ eventLike: false });
    expect(
      wrapper.find('[data-test="check-probe"]').attributes('data-checked'),
    ).toBe('false');

    wrapper.unmount();
  });

  it('包装对象的取值按绑定事件名取出', /** 只关心包装对象内某个字段的控件不能被整对象当成值。 */ async () => {
    registerProbes({ CheckProbe }, { CheckProbe: 'checked' });
    const { wrapper } = await mountVbenForm({
      schema: [
        {
          component: 'CheckProbe',
          defaultValue: { checked: 'yes', other: 'no' },
          fieldName: 'wrapped',
          label: '包装取值',
        },
      ],
    });

    expect(
      wrapper.find('[data-test="check-probe"]').attributes('data-checked'),
    ).toBe('yes');

    wrapper.unmount();
  });

  it('未声明取值时按空状态口径渲染控件', /** 空值口径写错会让受控控件收到无法识别的值。 */ async () => {
    registerProbes({ CheckProbe }, { CheckProbe: 'checked' });
    const { wrapper } = await mountVbenForm({
      commonConfig: { emptyStateValue: '空值' },
      schema: [
        {
          component: 'CheckProbe',
          fieldName: 'emptyWrapped',
          label: '空取值',
        },
      ],
    });

    expect(
      wrapper.find('[data-test="check-probe"]').attributes('data-checked'),
    ).toBe('空值');

    wrapper.unmount();
  });

  it('禁用变更监听时控件不收到 change 回调', /** 禁用开关失效会让控件在每次输入时都触发一次变更逻辑。 */ async () => {
    registerProbes({ CheckProbe }, { CheckProbe: 'checked' });
    const { wrapper } = await mountVbenForm({
      commonConfig: { disabledOnChangeListener: true },
      schema: [
        { component: 'CheckProbe', fieldName: 'noChange', label: '无变更回调' },
      ],
    });

    expect(
      wrapper.find('[data-test="check-probe"]').attributes('data-has-change'),
    ).toBe('false');

    wrapper.unmount();
  });

  it('非事件取值直接交给字段回调', /** 把普通取值当事件解包会让数字、字符串控件写不进表单。 */ async () => {
    registerProbes({ CheckProbe }, { CheckProbe: 'checked' });
    const { formApi, wrapper } = await mountVbenForm({
      commonConfig: { disabledOnChangeListener: false },
      schema: [
        {
          component: 'CheckProbe',
          componentProps: { payload: 'plain' },
          fieldName: 'plainValue',
          label: '普通取值',
        },
      ],
    });

    await wrapper.find('[data-test="check-probe"]').trigger('click');
    await flushPromises();
    await flushPromises();

    await expect(formApi.getValues()).resolves.toEqual({
      plainValue: '普通取值',
    });

    wrapper.unmount();
  });

  it('事件目标缺少取值属性时回退为整个事件对象', /** 目标字段不存在却返回 undefined 会让控件值被清空。 */ async () => {
    registerProbes({ CheckProbe }, { CheckProbe: 'checked' });
    const { formApi, wrapper } = await mountVbenForm({
      commonConfig: { disabledOnChangeListener: false },
      schema: [
        {
          component: 'CheckProbe',
          componentProps: { payload: 'missing' },
          fieldName: 'missingTarget',
          label: '缺少目标字段',
        },
      ],
    });

    await wrapper.find('[data-test="check-probe"]').trigger('click');
    await flushPromises();
    await flushPromises();

    const values = (await formApi.getValues()) as {
      missingTarget?: { target?: Record<string, unknown> };
    };
    expect(values.missingTarget?.target).toEqual({});

    wrapper.unmount();
  });

  it('页面自定义的 onChange 与 onInput 覆盖默认绑定', /** 自定义事件被默认绑定覆盖会让业务无法在变更时做额外处理。 */ async () => {
    const onChange = vi.fn();
    const onInput = vi.fn();
    const { wrapper } = await mountForm({
      schema: [
        {
          component: 'TextProbe',
          componentProps: { onChange, onInput },
          fieldName: 'customEvents',
          label: '自定义事件',
        },
      ],
    });

    const input = wrapper.find('[data-test="text-probe"]');
    await input.trigger('change');
    await input.trigger('input');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});

describe('渲染细节', /** 聚焦、插槽、标签与后缀决定页面的可见效果与可访问性。 */ () => {
  it('声明 autofocus 时自动聚焦到控件实例', /** 自动聚焦失效会让用户打开表单后仍需手动点击第一个字段。 */ async () => {
    const { wrapper } = await mountForm({
      schema: [
        {
          component: 'FocusProbe',
          componentProps: { autofocus: true },
          fieldName: 'focused',
          label: '聚焦字段',
        },
      ],
    });

    expect(wrapper.find('[data-test="focus-probe"]').exists()).toBe(true);
    expect(focusCalls).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('renderComponentContent 的返回值渲染进控件插槽', /** 自定义内容不落地会让业务无法复用同一个字段渲染多处内容。 */ async () => {
    const renderContent = vi.fn(
      /**
       * 按当前表单值生成控件默认插槽内容。
       * @param values 当前表单值集合。
       * @returns 插槽名到渲染函数的映射。
       */
      (values: Record<string, unknown>) => ({
        /** 把当前表单值渲染成控件插槽内容。 */
        default: () =>
          h(
            'span',
            { 'data-test': 'rendered-content' },
            `当前值:${values.contentField}`,
          ),
      }),
    );
    registerProbes({ SlotProbe });
    const { wrapper } = await mountVbenForm({
      schema: [
        {
          component: 'SlotProbe',
          defaultValue: '内容值',
          fieldName: 'contentField',
          label: '内容字段',
          renderComponentContent: renderContent,
        },
      ],
    });

    expect(renderContent).toHaveBeenCalled();
    expect(wrapper.find('[data-test="rendered-content"]').text()).toBe(
      '当前值:内容值',
    );

    wrapper.unmount();
  });

  it('非字符串标签收敛为空串但内容仍按渲染函数显示', /** 把函数标签当字符串交给校验库会输出对象字面量。 */ async () => {
    const { wrapper } = await mountForm({
      schema: [
        {
          component: 'TextProbe',
          fieldName: 'functionLabel',
          /** 以渲染函数声明标签，用于核对非字符串标签的收敛口径。 */
          label: () => h('span', { 'data-test': 'fn-label' }, '函数标签'),
        },
      ],
    });

    expect(wrapper.find('[data-test="fn-label"]').text()).toBe('函数标签');
    expect(wrapper.findComponent(Field).props('label')).toBe('');

    wrapper.unmount();
  });

  it('声明后缀时在控件右侧渲染后缀内容', /** 后缀丢失会让单位、说明一类信息在页面上消失。 */ async () => {
    const { wrapper } = await mountForm({
      schema: [
        {
          component: 'TextProbe',
          fieldName: 'withSuffix',
          label: '带后缀',
          suffix: '元',
        },
      ],
    });

    expect(wrapper.text()).toContain('元');

    wrapper.unmount();
  });

  it('表单项挂载时登记控件引用、卸载时清理', /** 不登记会让外部拿不到控件实例，不清理会在销毁后写入失效引用。 */ async () => {
    const { refMap, wrapper } = await mountForm({
      schema: [
        { component: 'TextProbe', fieldName: 'registered', label: '登记字段' },
      ],
    });

    expect(refMap.has('registered')).toBe(true);

    wrapper.unmount();

    expect(refMap.has('registered')).toBe(false);
  });
});
