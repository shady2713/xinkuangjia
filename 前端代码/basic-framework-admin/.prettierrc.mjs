/**
 * 本工程 Prettier 配置入口：直接转出 @vben/prettier-config 的默认导出，
 * 让根目录与各包共用同一套格式化规则。
 *
 * 规则取值在 internal/lint-configs/prettier-config 维护，此处不覆盖任何选项。
 */
export { default } from '@vben/prettier-config';
