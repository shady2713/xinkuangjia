/**
 * 点选验证码的点位采集状态：按点击顺序累积点位并支持原地清空，
 * 供点选验证码渲染序号标记、并向业务方回传坐标。
 * 只维护数组本身，坐标换算与越界拦截由调用组件完成。
 */
import type { CaptchaPoint } from '../types';

import { reactive } from 'vue';

export function useCaptchaPoints() {
  const points = reactive<CaptchaPoint[]>([]);
  function addPoint(point: CaptchaPoint) {
    points.push(point);
  }

  function clearPoints() {
    points.splice(0);
  }
  return {
    addPoint,
    clearPoints,
    points,
  };
}
