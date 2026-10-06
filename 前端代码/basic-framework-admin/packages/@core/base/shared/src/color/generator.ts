/**
 * 主题色阶变量生成：把主色展开成 50~950 色阶，输出 --名称-色阶 的 HSL 变量。
 * 供构建期与运行时注入 CSS 变量使用；不写 DOM，也不解析颜色格式。
 */
import { getColors } from 'theme-colors';

import { convertToHslCssVar, TinyColor } from './convert';

/**
 * 待展开的颜色条目：`name` 是主变量名，`alias` 可选，`color` 为可被 TinyColor 解析的源色值。
 */
interface ColorItem {
  alias?: string;
  color: string;
  name: string;
}

/**
 * 把一组主色展开成 50~950 色阶的 CSS 变量表。
 * 每个条目输出 `--{name}-{色阶}`；带 alias 时额外输出 `--{alias}-{色阶}` 与指向 500 色阶的 `--{alias}`。
 * 只读取入参并返回新对象，不接触 DOM；条目 color 为空时整条跳过，不产生任何变量。
 * @param colorItems - 颜色条目列表，顺序决定变量的写入顺序。
 * @returns 变量名到 HSL 颜色值的映射；入参为空时返回空对象。
 */
function generatorColorVariables(colorItems: ColorItem[]) {
  const colorVariables: Record<string, string> = {};

  colorItems.forEach(({ alias, color, name }) => {
    if (color) {
      const colorsMap = getColors(new TinyColor(color).toHexString());

      let mainColor = colorsMap['500'];

      const colorKeys = Object.keys(colorsMap);

      colorKeys.forEach((key) => {
        const colorValue = colorsMap[key];

        if (colorValue) {
          const hslColor = convertToHslCssVar(colorValue);
          colorVariables[`--${name}-${key}`] = hslColor;
          if (alias) {
            colorVariables[`--${alias}-${key}`] = hslColor;
          }

          if (key === '500') {
            mainColor = hslColor;
          }
        }
      });
      if (alias && mainColor) {
        colorVariables[`--${alias}`] = mainColor;
      }
    }
  });
  return colorVariables;
}

export { generatorColorVariables };
