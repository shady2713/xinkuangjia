/**
 * 将字符串的首字母大写
 * @param string
 */
function capitalizeFirstLetter(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * 将字符串的首字母转换为小写。
 *
 * @param str 要转换的字符串
 * @returns 首字母小写的字符串
 */
function toLowerCaseFirstLetter(str: string): string {
  if (!str) return str; // 如果字符串为空，直接返回
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 *  生成驼峰命名法的键名
 * @param key
 * @param parentKey
 */
function toCamelCase(key: string, parentKey: string): string {
  if (!parentKey) {
    return key;
  }
  return parentKey + key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * 把短横线分隔的命名转成小驼峰，用于把 CSS 变量名还原成对象键名。
 * @param str - 待转换的短横线命名；连续短横线产生的空段会被丢弃。
 * @returns 首段原样保留、后续段首字母大写并去掉短横线的字符串；空串仍返回空串。
 */
function kebabToCamelCase(str: string): string {
  return str
    .split('-')
    .filter(Boolean)
    .map((word, index) =>
      index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('');
}

export {
  capitalizeFirstLetter,
  kebabToCamelCase,
  toCamelCase,
  toLowerCaseFirstLetter,
};
