/** 移动端判定：视口小于 Tailwind 的 md 断点时返回真值，供布局与弹窗选形态。 */
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core';

export function useIsMobile() {
  const breakpoints = useBreakpoints(breakpointsTailwind);
  const isMobile = breakpoints.smaller('md');
  return { isMobile };
}
