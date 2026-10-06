/**
 * 颜色明暗判定：解析 CSS 颜色串后判断其属于深色还是浅色。
 * 供换肤与前景色选择使用；格式转换与色阶派生由同目录其它模块负责。
 */
import { TinyColor } from '@ctrl/tinycolor';

/**
 * 判断颜色是否偏暗，用于决定其上的前景文字取亮色还是暗色。
 * @param color - 任意可被 TinyColor 解析的 CSS 颜色串，如 `#fff`、`rgb(...)` 或颜色名。
 * @returns 感知亮度低于 128（0~255 区间）时为 true；无法解析的颜色按黑色处理，同样为 true。
 */
export function isDarkColor(color: string) {
  return new TinyColor(color).isDark();
}

/**
 * 判断颜色是否偏亮，与 isDarkColor 互补：二者共用亮度阈值 128，结果必然相反。
 * @param color - 任意可被 TinyColor 解析的 CSS 颜色串，如 `#fff`、`rgb(...)` 或颜色名。
 * @returns 感知亮度不低于 128 时为 true；无法解析的颜色按黑色处理，因此为 false。
 */
export function isLightColor(color: string) {
  return new TinyColor(color).isLight();
}
