/**
 * form-create 能力出口：暴露 useApiSelect 接口下拉工厂，并转发 helpers 属性面板工具。
 * 业务侧通过它拿到接口驱动选择器与 makeRequiredRule、localeProps；
 * 组件实现与设计器规则在同级 components、rules 目录，本文件不做实现。
 */
export { useApiSelect } from './components/use-api-select';

export * from './helpers';
