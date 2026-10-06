/**
 * 工具桶文件：提供 findIndex 兼容实现，并转发时间范围选择器默认属性。
 *
 * findIndex 在缺少原生实现时退化为 some 遍历，只查下标不改原数组；
 * 其余业务格式化与请求工具分散在各业务目录，不在此文件实现。
 */
import type { Recordable } from '@vben/types';

export * from './rangePickerProps';

/**
 * 查找元素下标的判定回调，与 `Array.prototype.findIndex` 的参数签名保持一致。
 * @param item 当前候选元素。
 * @param index 当前候选元素在数组中的下标。
 * @param array 正在被遍历的原数组，可用于读取相邻元素。
 * @returns 命中返回 true，找到第一个即停止。
 */
type Fn<T = unknown> = (item: T, index: number, array: Array<T>) => boolean;

/**
 * 查找数组中第一个满足条件的元素下标。
 * 运行环境缺少 `Array.prototype.findIndex` 时退化为 `some` 遍历，
 * 保证在旧浏览器上行为一致而不是直接抛错。
 * @param ary 待查找的数组。
 * @param fn 判定回调，返回 true 表示命中。
 * @returns 命中元素的下标；没有命中时为 -1。
 */
export const findIndex = <T = Recordable<unknown>>(
  ary: Array<T>,
  fn: Fn<T>,
): number => {
  if (ary.findIndex) {
    return ary.findIndex(
      /**
       * 原样转发三个参数，让判定回调也能读取下标和原数组。
       * @param item 当前候选元素。
       * @param index 当前候选元素的下标。
       * @param array 正在被遍历的原数组。
       */
      (item, index, array) => fn(item, index, array),
    );
  }
  let index = -1;
  ary.some(
    /**
     * 命中后立即中止遍历，与 findIndex 的短路语义一致。
     * @param item 当前候选元素。
     * @param i 当前候选元素的下标。
     * @param ary 正在被遍历的原数组。
     */
    (item: T, i: number, ary: Array<T>) => {
      const ret: boolean = fn(item, i, ary);
      if (ret) {
        index = i;
        return true;
      }
      return false;
    },
  );
  return index;
};
