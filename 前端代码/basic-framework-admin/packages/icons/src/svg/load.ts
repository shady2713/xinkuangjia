/**
 * 本地 svg 注册：导入时把 ./icons 下的 svg 原文解析出图形体、根属性与 viewBox，
 * 以 svg:<文件名> 注册进 iconify 图标集，重复导入由 loaded 标记拦截。
 * 由 ../svg/index.ts 副作用引入，自身不导出成员。
 */
import type { IconifyIconStructure } from '@vben-core/icons';

import { addIcon } from '@vben-core/icons';

let loaded = false;
if (!loaded) {
  loadSvgIcons();
  loaded = true;
}

/**
 * 把 svg 原文解析成 iconify 的图标结构。
 * 保留根元素上的 fill、stroke、fill-rule 与 stroke-width，并在有值时用 <g> 包裹内容；
 * viewBox 拆成 left/top/width/height，分段不是数字时对应项为 undefined。
 * @param svgData - svg 文件的原始文本。
 * @returns 可直接交给 addIcon 的图标结构。
 */
function parseSvg(svgData: string): IconifyIconStructure {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(svgData, 'image/svg+xml');
  const svgElement = xmlDoc.documentElement;

  // 提取 SVG 根元素的关键样式属性
  const getAttrs = (el: Element, attrs: string[]) =>
    attrs
      .map((attr) =>
        el.hasAttribute(attr) ? `${attr}="${el.getAttribute(attr)}"` : '',
      )
      .filter(Boolean)
      .join(' ');

  const rootAttrs = getAttrs(svgElement, [
    'fill',
    'stroke',
    'fill-rule',
    'stroke-width',
  ]);

  // 只序列化元素节点，文本与注释节点会被丢弃，避免把格式化空白带进图标体。
  const svgContent = [...svgElement.childNodes]
    .filter((node) => node.nodeType === Node.ELEMENT_NODE)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join('');
  // 若根有属性，用一个 g 标签包裹内容并继承属性
  const body = rootAttrs ? `<g ${rootAttrs}>${svgContent}</g>` : svgContent;

  const viewBoxValue = svgElement.getAttribute('viewBox') || '';
  // viewBox 缺省时各项为 undefined，交由 iconify 按默认视图盒渲染。
  const [left, top, width, height] = viewBoxValue.split(' ').map((val) => {
    const num = Number(val);
    return Number.isNaN(num) ? undefined : num;
  });

  return {
    body,
    height,
    left,
    top,
    width,
  };
}

/**
 * 自定义的svg图片转化为组件
 * @example ./svg/avatar.svg
 * <Icon icon="svg:avatar"></Icon>
 */
async function loadSvgIcons() {
  const svgEagers = import.meta.glob('./icons/**', {
    eager: true,
    query: '?raw',
  });

  await Promise.all(
    Object.entries(svgEagers).map((svg) => {
      const [key, body] = svg as [string, string | { default: string }];

      // ./icons/xxxx.svg => xxxxxx
      const start = key.lastIndexOf('/') + 1;
      const end = key.lastIndexOf('.');
      const iconName = key.slice(start, end);

      return addIcon(`svg:${iconName}`, {
        ...parseSvg(typeof body === 'object' ? body.default : body),
      });
    }),
  );
}
