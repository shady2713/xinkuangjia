/** 移动端判定：视口小于 Tailwind 的 md 断点时返回真值，供布局与弹窗选形态。 */
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core';

/**
 * 生成移动端判定：基于 Tailwind 断点，视口宽度小于 md 时 isMobile 为真。
 * @returns 含 isMobile 的响应式对象，视口跨越断点时会自动更新。
 */
export function useIsMobile() {
  const breakpoints = useBreakpoints(breakpointsTailwind);
  const isMobile = breakpoints.smaller('md');
  return { isMobile };
}
