/**
 * 字典标签出口：只暴露 DictTag，按字典类型与字典值渲染带颜色的标签。
 * 供表格列与详情页展示枚举文案；字典缓存由 @vben/hooks 提供，本模块不发请求。
 */
export { default as DictTag } from './dict-tag.vue';
