/**
 * 表单适配注册表：维护控件映射、v-model 事件名与全局公共配置。
 * 由 setupVbenForm 启动时写入，component 名在此解析。
 * 只提供查找表，不参与渲染与校验。
 */
import type { Component } from 'vue';

import type {
  BaseFormComponentType,
  FormCommonConfig,
  VbenFormAdapterOptions,
} from './types';

import { h } from 'vue';

import {
  VbenButton,
  VbenCheckbox,
  Input as VbenInput,
  VbenInputPassword,
  VbenPinInput,
  VbenSelect,
} from '@vben-core/shadcn-ui';
import { globalShareState } from '@vben-core/shared/global-state';

import { defineRule } from 'vee-validate';

const DEFAULT_MODEL_PROP_NAME = 'modelValue';

/** 全局表单公共配置的单例，由 setupVbenForm 在应用启动时写入，各表单渲染时按需读取。 */
export const DEFAULT_FORM_COMMON_CONFIG: FormCommonConfig = {};

/** schema 中控件名到实际组件的登记表；业务注册的控件会追加或覆盖这里的内置默认项。 */
export const COMPONENT_MAP: Record<BaseFormComponentType, Component> = {
  DefaultButton: h(VbenButton, { size: 'sm', variant: 'outline' }),
  PrimaryButton: h(VbenButton, { size: 'sm', variant: 'default' }),
  VbenCheckbox,
  VbenInput,
  VbenInputPassword,
  VbenPinInput,
  VbenSelect,
};

/**
 * 控件名到其 v-model 绑定属性名的对照表。
 * 取值属性名与默认 modelValue 相同的控件不需要登记，登记项会覆盖内置默认。
 */
export const COMPONENT_BIND_EVENT_MAP: Partial<
  Record<BaseFormComponentType, string>
> = {
  VbenCheckbox: 'checked',
};

/**
 * 判断全局组件登记值能否作为 Vue 组件使用。
 * Vue 接受组件对象、函数式组件、h() 生成的 vnode 以及原生标签名，
 * 因此这里只排除 null/undefined、原始数值与布尔值；
 * 其余对象按组件定义登记，登记错误在渲染时才暴露，但不会污染组件映射表。
 * @param value 全局组件登记表中的取值，其类型无法在登记表层面表达。
 * @returns 是合法组件定义时返回 true，用于把 unknown 收窄为 Component。
 */
function isRegisteredComponent(value: unknown): value is Component {
  return (
    typeof value === 'string' ||
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null)
  );
}

/**
 * 登记表单适配配置：控件映射、v-model 事件名与自定义命名规则。
 * 只在应用启动时调用一次，重复调用会以最后一次传入的配置为准。
 * @param options 适配配置，包含控件行为默认值与业务自定义校验规则。
 */
export function setupVbenForm<
  T extends BaseFormComponentType = BaseFormComponentType,
>(options: VbenFormAdapterOptions<T>) {
  const { config, defineRules } = options;

  const {
    disabledOnChangeListener = true,
    disabledOnInputListener = true,
    emptyStateValue = undefined,
  } = (config || {}) as FormCommonConfig;

  Object.assign(DEFAULT_FORM_COMMON_CONFIG, {
    disabledOnChangeListener,
    disabledOnInputListener,
    emptyStateValue,
  });

  if (defineRules) {
    // 用 entries 遍历拿到确定存在的规则，避免索引访问带入 undefined。
    for (const [key, rule] of Object.entries(defineRules)) {
      defineRule(key, rule);
    }
  }

  const baseModelPropName =
    config?.baseModelPropName ?? DEFAULT_MODEL_PROP_NAME;
  const modelPropNameMap = config?.modelPropNameMap as
    | Record<BaseFormComponentType, string>
    | undefined;

  const components = globalShareState.getComponents();

  for (const [component, value] of Object.entries(components)) {
    // 登记值不是合法组件时跳过，避免把 undefined 写进组件映射表
    if (!isRegisteredComponent(value)) {
      continue;
    }
    const key = component as BaseFormComponentType;
    COMPONENT_MAP[key] = value;

    if (baseModelPropName !== DEFAULT_MODEL_PROP_NAME) {
      COMPONENT_BIND_EVENT_MAP[key] = baseModelPropName;
    }

    // 覆盖特殊组件的modelPropName
    if (modelPropNameMap && modelPropNameMap[key]) {
      COMPONENT_BIND_EVENT_MAP[key] = modelPropNameMap[key];
    }
  }
}
