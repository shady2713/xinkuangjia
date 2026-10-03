/** form-create 设计器属性面板的公共工具：统一"是否必填"行与属性面板文案国际化。 */
import type { FormCreatePropsRule, FormCreateTranslate } from './typing';

/**
 * 生成 form-create 设计器中"是否必填"的规则配置项，field 使用固定的 formCreate$required 以便国际化时统一识别
 * @returns 一条可直接放进属性面板的必填开关配置行
 */
export function makeRequiredRule(): FormCreatePropsRule {
  return {
    type: 'Required',
    field: 'formCreate$required',
    title: '是否必填',
  };
}

/**
 * 把规则配置项的 title 替换为国际化文案。
 *
 * `_optionType` 是 form-create 自身的组件类型选择行，不属于目标组件属性，
 * 因此跳过翻译，避免语言包缺键时把它覆盖成无意义的 key。
 *
 * @param t 国际化翻译函数，由 form-create 设计器上下文提供
 * @param prefix 组件前缀，用于拼接 components.<prefix>.<field> 的语言键
 * @param rules 待处理的规则配置项；翻译缺失时保留原 title，不回退为空
 * @returns 处理后的规则配置项（在原对象上修改）
 */
export function localeProps(
  t: FormCreateTranslate,
  prefix: string,
  rules: FormCreatePropsRule[],
): FormCreatePropsRule[] {
  return rules.map(
    /**
     * 就地替换单行配置的中文文案。
     * @param rule 待翻译的属性面板配置行，会被就地修改
     * @returns 同一个配置行对象，方便链式传递
     */
    (rule) => {
      if (rule.field === 'formCreate$required') {
        rule.title = t('props.required') || rule.title;
      } else if (rule.field && rule.field !== '_optionType') {
        rule.title = t(`components.${prefix}.${rule.field}`) || rule.title;
      }
      return rule;
    },
  );
}
