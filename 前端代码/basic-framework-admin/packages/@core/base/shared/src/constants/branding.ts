/**
 * 品牌与站点地址常量：声明文档地址、Logo 地址与各 UI 框架预览站地址。
 * 当前只有 VBEN_LOGO_URL 指向站内 /brand-logo.svg，其余留空待部署方覆盖；
 * 仅提供取值，不承载运行时逻辑，也不参与环境变量的读取与合并。
 */
export const VBEN_DOC_URL = '';

/** 站点 Logo 地址，默认取站内静态资源 /brand-logo.svg。 */
export const VBEN_LOGO_URL = '/brand-logo.svg';

/** 默认预览站根地址，留空表示未配置，由部署方覆盖。 */
export const VBEN_PREVIEW_URL = '';

/** Ant Design Vue Next 预览站地址，留空表示未配置。 */
export const VBEN_ANTDV_NEXT_PREVIEW_URL = '';

/** Element Plus 预览站地址，留空表示未配置。 */
export const VBEN_ELE_PREVIEW_URL = '';

/** Naive UI 预览站地址，留空表示未配置。 */
export const VBEN_NAIVE_PREVIEW_URL = '';

/** Ant Design Vue 预览站地址，留空表示未配置。 */
export const VBEN_ANT_PREVIEW_URL = '';

/** TDesign 预览站地址，留空表示未配置。 */
export const VBEN_TD_PREVIEW_URL = '';
