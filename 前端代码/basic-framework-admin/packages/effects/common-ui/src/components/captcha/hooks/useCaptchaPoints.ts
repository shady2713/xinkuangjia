/**
 * 点选验证码的点位采集状态：按点击顺序累积点位并支持原地清空，
 * 供点选验证码渲染序号标记、并向业务方回传坐标。
 * 只维护数组本身，坐标换算与越界拦截由调用组件完成。
 */
import type { CaptchaPoint } from '../types';

import { reactive } from 'vue';

/**
 * 提供点选验证码的点位采集状态与增删方法。
 * @returns points 为按点击顺序累积的点位数组，addPoint 追加点位，clearPoints 就地清空。
 */
export function useCaptchaPoints() {
  const points = reactive<CaptchaPoint[]>([]);
  /** 追加一个点位；不做去重与越界判断，坐标合法性由调用方保证。 */
  function addPoint(point: CaptchaPoint) {
    points.push(point);
  }

  /** 就地清空全部点位；保留原数组引用，已订阅该数组的视图会自动更新。 */
  function clearPoints() {
    points.splice(0);
  }
  return {
    addPoint,
    clearPoints,
    points,
  };
}
