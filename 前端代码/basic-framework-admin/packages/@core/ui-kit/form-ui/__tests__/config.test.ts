/**
 * 表单适配配置（config）的真实行为回归。
 *
 * `setupVbenForm` 是应用启动时登记表单适配能力的唯一入口：它必须把合法组件写入
 * 全局组件映射表、跳过非法登记值、把通用行为写入共享配置，并按 baseModelPropName
 * 与 modelPropNameMap 覆盖 v-model 事件名；`defineRules` 注册的业务规则必须真的能被
 * 校验链路使用。用例通过真实 vee-validate 校验消费规则，验证的不是镜像实现。
 */
import { defineComponent } from 'vue';

import { globalShareState } from '@vben-core/shared/global-state';

import { validate } from 'vee-validate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  COMPONENT_BIND_EVENT_MAP,
  COMPONENT_MAP,
  DEFAULT_FORM_COMMON_CONFIG,
  setupVbenForm,
} from '../src/config';

/** 用例前的真实全局状态快照，用于用例结束后原样恢复。 */
let snapshot: ReturnType<typeof captureState>;

/**
 * 记录当前组件登记表与共享配置。
 * @returns 全局状态的可写副本。
 */
function captureState() {
  return {
    componentBindEventMap: { ...COMPONENT_BIND_EVENT_MAP },
    componentMap: { ...COMPONENT_MAP },
    components: { ...globalShareState.getComponents() },
    formCommonConfig: { ...DEFAULT_FORM_COMMON_CONFIG },
  };
}

/**
 * 用给定成员整体替换共享对象的成员，保持导出对象的引用不变。
 * @param target 被替换成员的共享对象。
 * @param source 替换后的成员集合。
 */
function replaceMembers(target: object, source: object) {
  for (const key of Object.keys(target)) {
    Reflect.deleteProperty(target, key);
  }
  Object.assign(target, source);
}

/**
 * 用快照恢复全局状态，删除用例新增的键。
 * @param state 之前记录的真实状态快照。
 */
function restoreState(state: ReturnType<typeof captureState>) {
  replaceMembers(COMPONENT_MAP, state.componentMap);
  replaceMembers(
    COMPONENT_BIND_EVENT_MAP as Record<string, unknown>,
    state.componentBindEventMap,
  );
  replaceMembers(DEFAULT_FORM_COMMON_CONFIG, state.formCommonConfig);
  globalShareState.setComponents(state.components);
}

describe('表单适配配置', /** 组件映射与通用配置决定所有业务表单的控件解析结果。 */ () => {
  beforeEach(
    /** 记录真实全局状态，避免用例写入影响其他用例。 */ () => {
      snapshot = captureState();
    },
  );

  afterEach(
    /** 恢复组件登记表与共享配置。 */ () => {
      restoreState(snapshot);
    },
  );

  it('合法组件登记进映射表，非法登记值被跳过', /** 把 null 或原始值写进组件映射表会让表单项渲染时报错或渲染出文本。 */ () => {
    const customComponent = defineComponent({
      name: 'CustomProbe',
      /** 渲染空节点，仅用于验证组件对象被真实登记。 */
      render: () => null,
    });
    globalShareState.setComponents({
      BooleanComponent: false,
      CustomProbe: customComponent,
      /** 函数式组件同样应被登记。 */
      FunctionComponent: () => null,
      NativeTag: 'span',
      NullComponent: null,
      NumberComponent: 42,
      UndefinedComponent: undefined,
    });

    setupVbenForm({});

    expect(COMPONENT_MAP.CustomProbe).toBe(customComponent);
    expect(COMPONENT_MAP.NativeTag).toBe('span');
    expect(COMPONENT_MAP.FunctionComponent).toBeTypeOf('function');
    expect('NullComponent' in COMPONENT_MAP).toBe(false);
    expect('NumberComponent' in COMPONENT_MAP).toBe(false);
    expect('BooleanComponent' in COMPONENT_MAP).toBe(false);
    expect('UndefinedComponent' in COMPONENT_MAP).toBe(false);
  });

  it('未传入配置时写入通用行为默认值', /** 默认值缺失会让所有表单在输入时立即触发校验，行为与设计不符。 */ () => {
    setupVbenForm({});

    expect(DEFAULT_FORM_COMMON_CONFIG).toMatchObject({
      disabledOnChangeListener: true,
      disabledOnInputListener: true,
      emptyStateValue: undefined,
    });
  });

  it('显式传入的通用行为覆盖默认值', /** 适配方显式关闭输入监听时必须真实生效。 */ () => {
    globalShareState.setComponents({
      ProbeSelect: defineComponent({
        name: 'ProbeSelect',
        /** 渲染空节点，仅用于验证事件名映射。 */
        render: () => null,
      }),
    });
    setupVbenForm({
      config: {
        baseModelPropName: 'checked',
        disabledOnChangeListener: false,
        disabledOnInputListener: false,
        emptyStateValue: null,
        modelPropNameMap: { ProbeSelect: 'value' },
      },
    });

    expect(DEFAULT_FORM_COMMON_CONFIG).toMatchObject({
      disabledOnChangeListener: false,
      disabledOnInputListener: false,
      emptyStateValue: null,
    });
    expect(COMPONENT_BIND_EVENT_MAP.ProbeSelect).toBe('value');
    expect(COMPONENT_BIND_EVENT_MAP.VbenCheckbox).toBe('checked');
  });

  it('defineRules 注册的业务规则可被真实校验链路使用', /** 规则没有真正注册时，业务表单的校验会静默通过。 */ async () => {
    setupVbenForm({
      defineRules: {
        /** 空值判定为不通过。 */
        probe_required: (value: unknown) => (value ? true : '必须填写'),
      },
    });

    await expect(validate('', 'probe_required')).resolves.toEqual({
      errors: ['必须填写'],
      valid: false,
    });
    await expect(validate('已填写', 'probe_required')).resolves.toEqual({
      errors: [],
      valid: true,
    });
  });
});
