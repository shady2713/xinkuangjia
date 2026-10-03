/** 通用下拉类组件的设计器规则：复用 selectRule 的公共属性面板，并叠加调用方传入的默认值。 */
import type {
  FormCreatePropsContext,
  FormCreateRule,
  SelectRuleOption,
} from '#/components/form-create/typing';

import { buildUUID, cloneDeep } from '@vben/utils';

import {
  localeProps,
  makeRequiredRule,
} from '#/components/form-create/helpers';
import { selectRule } from '#/components/form-create/rules/data';

/**
 * 通用选择器规则 hook
 *
 * @param option 规则配置；props 中的每一项既是属性面板的一行，也会作为目标组件的默认值覆盖项
 * @returns form-create 设计器注册项：rule 生成表单规则，props 生成属性面板配置行
 */
export function useSelectRule(option: SelectRuleOption) {
  const label = option.label;
  const name = option.name;
  const rules = cloneDeep(selectRule);
  return {
    icon: option.icon,
    label,
    name,
    event: option.event,
    /**
     * 生成一条表单规则。
     * @returns 带 UUID 字段名的规则对象；option.props 中有默认值的属性会写入 rule.props
     */
    rule(): FormCreateRule {
      // 构建基础规则
      const baseRule: FormCreateRule = {
        type: name,
        field: buildUUID(),
        title: label,
        info: '',
        $required: false,
      };
      // 将自定义 props 的默认值添加到 rule 的 props 中
      if (option.props && option.props.length > 0) {
        baseRule.props = {};
        for (const prop of option.props) {
          // value 为 undefined 表示设计器未填默认值，此时保留组件自身的默认值
          if (prop.field && prop.value !== undefined) {
            baseRule.props[prop.field] = prop.value;
          }
        }
      }
      return baseRule;
    },
    /**
     * 生成该组件的属性面板配置行。
     * @param _name form-create 传入的目标组件名，本工程按闭包中的 name 取配置故不使用
     * @param context 设计器上下文，只取其中的 t 翻译函数
     * @returns 已完成文案国际化的属性面板配置行数组
     */
    props(_name: string, context: FormCreatePropsContext) {
      const { t } = context;
      if (!option.props) {
        option.props = [];
      }
      return localeProps(t, `${name}.props`, [
        makeRequiredRule(),
        ...option.props,
        ...rules,
      ]);
    },
  };
}
