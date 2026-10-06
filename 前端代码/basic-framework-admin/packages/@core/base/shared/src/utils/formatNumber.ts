/**
 * 数值与金额格式化：分元换算、小数补位、环比与 ERP 数量/价格展示在此统一。
 * 含 vxe 表格列 formatter 与输入框格式化两类入口；只决定展示形态，
 * 计算口径与单位约定由调用方决定。
 */
import { isEmpty, isString, isUndefined } from './inference';

/**
 * 将一个整数转换为分数保留传入的小数
 * @param num
 * @param digit
 */
export function formatToFractionDigit(
  num: number | string | undefined,
  digit: number = 2,
): string {
  if (isUndefined(num)) return '0.00';
  const parsedNumber = isString(num) ? Number.parseFloat(num) : num;
  return (parsedNumber / 100).toFixed(digit);
}

/**
 * 将一个整数转换为分数保留两位小数
 * @param num
 */
export function formatToFraction(num: number | string | undefined): string {
  return formatToFractionDigit(num, 2);
}

/**
 * 把已格式化的数字串补齐成两位小数的展示形式。
 *
 * 小数位数由调用方解析后显式传入：`toFixed(2)` 的正常结果只有 0 或 2 位小数，
 * 但指数写法（如 `1.5e+21`）与上游实现变更都可能交出其他位数，因此这里按传入位数
 * 逐一约定结果，位数未知时退回默认展示串而不是交出残缺文本。
 *
 * @param formatted 已格式化的数字串，作为补齐的基串原样使用
 * @param decimalLength formatted 小数部分的长度，由调用方从该串解析得到
 * @returns 0 位小数补 `.00`；1 位小数补一个 `0`；2 位小数原样返回；
 * 其余长度无法补齐，返回默认串 `0.00`
 */
export function padFractionToTwoDigits(
  formatted: string,
  decimalLength: number,
): string {
  switch (decimalLength) {
    case 0: {
      return `${formatted}.00`;
    }
    case 1: {
      return `${formatted}0`;
    }
    case 2: {
      return formatted;
    }
    default: {
      return '0.00';
    }
  }
}

/**
 * 将一个数转换为 1.00 这样
 * 数据呈现的时候使用
 *
 * @param num 整数
 * @returns 固定两位小数的展示串；入参未定义或无法补齐时返回 '0.00'
 */
export function floatToFixed2(num: number | string | undefined): string {
  if (isUndefined(num)) return '0.00';
  const f = formatToFraction(num);
  const decimalPart = f.toString().split('.')[1];
  const len = decimalPart ? decimalPart.length : 0;
  return padFractionToTwoDigits(f.toString(), len);
}

/**
 * 将一个分数转换为整数
 * @param num 分值，允许数字或文本形式的数字
 * @returns 四舍五入后的整数分值；入参未定义时为 0
 */
export function convertToInteger(num: number | string | undefined): number {
  if (isUndefined(num)) return 0;
  const parsedNumber = isString(num) ? Number.parseFloat(num) : num;
  return Math.round(parsedNumber * 100);
}

/**
 * 元转分
 */
export function yuanToFen(amount: number | string): number {
  return convertToInteger(amount);
}

/**
 * 分转元
 */
export function fenToYuan(price: number | string): string {
  return formatToFraction(price);
}

/**
 * 格式化金额【分转元】。
 * @description 作为 vxe-table 的 cellFormatter 使用，签名由 vxe-table 决定：
 * 依次是列对象、行对象、单元格值、表格实例；前两个参数本格式化用不到但必须占位。
 * @param _column 列对象，本格式化不使用
 * @param _row 行对象，本格式化不使用
 * @param cellValue 单元格内的分值
 * @param _instance 表格实例，本格式化不使用
 * @returns 带人民币符号的元金额；cellValue 为空时返回 ￥0.00
 */
export const fenToYuanFormat = (
  _column: unknown,
  _row: unknown,
  cellValue: number | string | undefined,
  _instance: unknown,
) => {
  return `￥${floatToFixed2(cellValue)}`;
};

/**
 * 计算环比
 *
 * @param value 当前数值
 * @param reference 对比数值
 */
export function calculateRelativeRate(
  value?: number,
  reference?: number,
): number {
  // 防止除0
  if (!reference || reference === 0) return 0;

  return Number.parseFloat(
    ((100 * ((value || 0) - reference)) / reference).toFixed(0),
  );
}

// ========== ERP 专属方法 ==========

const ERP_COUNT_DIGIT = 3;
const ERP_PRICE_DIGIT = 2;

/**
 * 【ERP】格式化 Input 数字
 *
 * 例如说：库存数量
 *
 * @param num 数量
 * @package
 * @return 格式化后的数量
 */
export function erpNumberFormatter(
  num: number | string | undefined,
  digit: number,
) {
  if (num === null || num === undefined) {
    return '';
  }
  if (typeof num === 'string') {
    num = Number.parseFloat(num);
  }
  // 如果非 number，则直接返回空串
  if (Number.isNaN(num)) {
    return '';
  }
  return num.toFixed(digit);
}

/**
 * 【ERP】格式化数量，保留三位小数
 *
 * 例如说：库存数量
 *
 * @param num 数量
 * @return 格式化后的数量
 */
export function erpCountInputFormatter(num: number | string | undefined) {
  return erpNumberFormatter(num, ERP_COUNT_DIGIT);
}

/**
 * 【ERP】格式化数量，保留三位小数
 *
 * @param cellValue 数量
 * @return 格式化后的数量
 */
export function erpCountTableColumnFormatter(
  cellValue: number | string | undefined,
) {
  return erpNumberFormatter(cellValue, ERP_COUNT_DIGIT);
}

/**
 * 【ERP】格式化金额，保留二位小数
 *
 * 例如说：库存数量
 *
 * @param num 数量
 * @return 格式化后的数量
 */
export function erpPriceInputFormatter(num: number | string | undefined) {
  return erpNumberFormatter(num, ERP_PRICE_DIGIT);
}

/**
 * 【ERP】格式化金额，保留二位小数
 *
 * @param cellValue 数量
 * @return 格式化后的数量
 */
export function erpPriceTableColumnFormatter(
  cellValue: number | string | undefined,
) {
  return erpNumberFormatter(cellValue, ERP_PRICE_DIGIT);
}

/**
 * 【ERP】价格计算，四舍五入保留两位小数
 *
 * @param price 价格
 * @param count 数量
 * @return 总价格。如果有任一为空，则返回 undefined
 */
export function erpPriceMultiply(price: number, count: number) {
  if (isEmpty(price) || isEmpty(count)) return undefined;
  return Number.parseFloat((price * count).toFixed(ERP_PRICE_DIGIT));
}

/**
 * 【ERP】百分比计算，四舍五入保留两位小数
 *
 * 如果 total 为 0，则返回 0
 *
 * @param value 当前值
 * @param total 总值
 */
export function erpCalculatePercentage(value: number, total: number) {
  if (total === 0) return 0;
  return ((value / total) * 100).toFixed(2);
}
