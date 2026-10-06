/**
 * 颜色明暗判定：解析 CSS 颜色串后判断其属于深色还是浅色。
 * 供换肤与前景色选择使用；格式转换与色阶派生由同目录其它模块负责。
 */
import { TinyColor } from '@ctrl/tinycolor';

export function isDarkColor(color: string) {
  return new TinyColor(color).isDark();
}

export function isLightColor(color: string) {
  return new TinyColor(color).isLight();
}
