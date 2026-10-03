/**
 * 表格必填校验的 className 生成器。
 * 校验开关关闭时一律放行；开关打开后按内置 required 规则或调用方自定义函数判定当前行，
 * 不通过时返回错误样式类名，供 vxe-table 给单元格加红框。
 */
import type { Ref } from 'vue';

/**
 * 校验开关的取值来源。
 * 以 Ref 形态传入并通过可选链读取，因此调用方未提供时按「不校验」处理。
 */
type ValidationSwitch = Ref<boolean> | undefined;

/**
 * 把行数据对象当作可按字符串键取值的记录。
 * 必填校验的字段名由调用方在运行时给出，静态类型无法表达，
 * 因此在唯一的取值入口做一次收窄，取到的值一律按 unknown 继续传递。
 * @param row 待取值的行数据对象。
 * @returns 字段值按 unknown 暴露的记录视图。
 */
function asRowRecord(row: object): Record<string, unknown> {
  return row as Record<string, unknown>;
}

/**
 * 自定义行校验函数。
 * @param row vxe-table 提供的当前行数据，组件不解释其结构，判定逻辑由调用方实现。
 * @returns 返回 false 表示该行校验不通过。
 */
type RowValidationFn = (row: object) => boolean;

/**
 * 创建验证类名的工具函数
 * @param isValidating 验证状态，为假时直接放行、不返回错误样式
 * @param fieldName 字段名，内置规则据此从行数据中取值
 * @param validationRules 验证规则，可以是字符串或自定义函数
 * @returns 返回 className 函数，校验不通过时返回错误样式类名
 */
function createValidationClassName(
  isValidating: ValidationSwitch,
  fieldName: string,
  validationRules: RowValidationFn | string,
) {
  return (
    /**
     * 判定单行是否通过校验并给出单元格样式。
     * @param params vxe-table 的单元格上下文。
     * @param params.row 当前行数据，校验规则按字段名从这里取值。
     * @returns 空串表示通过；错误样式类名表示校验不通过。
     */
    (params: { row: object }) => {
      const { row } = params;
      if (!isValidating?.value) return '';

      let isValid = true;
      if (typeof validationRules === 'string') {
        // 处理简单的验证规则
        if (validationRules === 'required') {
          const value = asRowRecord(row)[fieldName];
          isValid =
            fieldName === 'count'
              ? // 数量列要求为大于 0 的数值。沿用原有的宽松比较语义：
                // 非空数值走 Number 转换，非法字符串得到 NaN 从而判定不通过。
                Boolean(value) && Number(value) > 0
              : // 其余字段只要求非空，按真值判断
                Boolean(value);
        }
      } else if (typeof validationRules === 'function') {
        // 处理自定义验证函数
        isValid = validationRules(row);
      }

      return isValid ? '' : 'required-field-error';
    }
  );
}

/**
 * 创建必填字段验证
 * @param isValidating 验证状态
 * @param fieldName 字段名
 * @returns 返回 className 函数
 */
function createRequiredValidation(
  isValidating: ValidationSwitch,
  fieldName: string,
) {
  return createValidationClassName(isValidating, fieldName, 'required');
}

/**
 * 创建自定义验证
 * @param isValidating 验证状态
 * @param validationFn 自定义验证函数，返回 false 表示校验不通过
 * @returns 返回 className 函数
 */
function createCustomValidation(
  isValidating: ValidationSwitch,
  validationFn: RowValidationFn,
) {
  return createValidationClassName(isValidating, '', validationFn);
}

export {
  createCustomValidation,
  createRequiredValidation,
  createValidationClassName,
};
