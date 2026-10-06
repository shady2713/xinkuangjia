/**
 * 设计器规则出口：聚合字典、iframe、通用下拉与文件、单图、多图上传六类规则 hook。
 * 供表单设计器与规则测试统一引用，属性面板公共模板来自 ./data 与上级 helpers；
 * 这里只做转发，各 hook 的默认值与属性行由对应 use-*-rule 模块维护。
 */
export { useDictSelectRule } from './use-dict-select';
export { useIframeRule } from './use-iframe-rule';
export { useSelectRule } from './use-select-rule';
export { useUploadFileRule } from './use-upload-file-rule';
export { useUploadImageRule } from './use-upload-image-rule';
export { useUploadImagesRule } from './use-upload-images-rule';
