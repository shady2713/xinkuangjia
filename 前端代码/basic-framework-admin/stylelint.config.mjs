/**
 * 前端仓库样式检查的根配置：继承 @vben/stylelint-config。
 *
 * root: true 终止向上查找，规则与忽略项都在共享预设内，
 * 此处不追加自定义规则，apps 与 packages 沿用同一预设。
 */
export default {
  extends: ['@vben/stylelint-config'],
  root: true,
};
