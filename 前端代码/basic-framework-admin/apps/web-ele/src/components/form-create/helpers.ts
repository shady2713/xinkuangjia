/** 生成 form-create 设计器中"是否必填"的规则配置项，field 使用固定的 formCreate$required 以便国际化时统一识别 */
export function makeRequiredRule() {
  return {
    type: 'Required',
    field: 'formCreate$required',
    title: '是否必填',
  };
}

/**
 * 把规则配置项的 title 替换为国际化文案。
 * @param t 国际化翻译函数
 * @param prefix 组件前缀，用于拼接 components.<prefix>.<field> 的语言键
 * @param rules 待处理的规则配置项；翻译缺失时保留原 title，不回退为空
 * @returns 处理后的规则配置项（在原对象上修改）
 */
export function localeProps(
  t: (msg: string) => any,
  prefix: string,
  rules: any[],
) {
  return rules.map((rule: { field: string; title: any }) => {
    if (rule.field === 'formCreate$required') {
      rule.title = t('props.required') || rule.title;
    } else if (rule.field && rule.field !== '_optionType') {
      rule.title = t(`components.${prefix}.${rule.field}`) || rule.title;
    }
    return rule;
  });
}
