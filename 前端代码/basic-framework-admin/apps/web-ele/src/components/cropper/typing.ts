/** 定义图片裁剪、头像上传及弹窗间的属性和事件载荷契约。 */
import type Cropper from 'cropperjs';
import type { ButtonProps } from 'element-plus';

import type { CSSProperties } from 'vue';

/** 上传接口的入参：裁剪后的图片二进制及原始文件名 */
export interface apiFunParams {
  /** 裁剪结果转换出的图片二进制内容 */
  file: Blob;
  /** 原始上传文件名，后端按此名称存储 */
  filename: string;
  /** 表单字段名，后端 multipart 解析时使用，固定传 'file' */
  name: string;
}

/** 裁剪完成事件的载荷 */
export interface CropendResult {
  /** 裁剪结果的 base64 dataURL，用于预览和转 Blob 上传 */
  imgBase64: string;
  /** cropperjs 的裁剪区域信息（坐标、尺寸、旋转角度等） */
  imgInfo: Cropper.Data;
}

/** 图片裁剪器（CropperImage）组件属性 */
export interface CropperProps {
  /** 待裁剪图片地址，支持远程 URL 或 base64 dataURL */
  src?: string;
  /** 图片的 alt 文本 */
  alt?: string;
  /** 是否按圆形裁剪输出，头像场景使用 */
  circled?: boolean;
  /** 是否在拖动/缩放过程中实时向父组件抛出裁剪结果；关闭后只在需要时手动触发 */
  realTimePreview?: boolean;
  /** 裁剪区域高度，支持数值（按 px）或带单位的字符串，默认 360px */
  height?: number | string;
  /** 图片跨域模式，远程图片跨域裁剪失败时按需配置 */
  crossorigin?: '' | 'anonymous' | 'use-credentials' | undefined;
  /** 附加到图片元素上的自定义样式 */
  imageStyle?: CSSProperties;
  /** 透传给 cropperjs 的选项，会覆盖 defaultOptions 中的同名配置 */
  options?: Cropper.Options;
}

/** 头像裁剪上传（CropperAvatar）组件属性 */
export interface CropperAvatarProps {
  /** 头像展示宽度，数值按 px 处理，默认 200 */
  width?: number | string;
  /** 当前头像地址，配合 update:value 支持 v-model:value */
  value?: string;
  /** 是否显示头像下方的上传按钮 */
  showBtn?: boolean;
  /** 透传给上传按钮的 Element Plus 按钮属性 */
  btnProps?: ButtonProps;
  /** 上传按钮文案，为空时使用国际化默认文案 */
  btnText?: string;
  /** 上传接口，接收裁剪后的 Blob，返回图片访问地址 */
  uploadApi?: (params: apiFunParams) => Promise<any>;
  /** 图片大小上限，单位 MB；不大于 0 表示不限制，默认 5 */
  size?: number;
}

/** 裁剪弹窗（CropperModal）组件属性 */
export interface CropperModalProps {
  /** 是否按圆形裁剪输出，默认 true */
  circled?: boolean;
  /** 上传接口，接收裁剪后的 Blob，返回图片访问地址 */
  uploadApi?: (params: apiFunParams) => Promise<any>;
  /** 初始展示的图片地址 */
  src?: string;
  /** 图片大小上限，单位 MB；不大于 0 表示不限制 */
  size?: number;
}

/** 默认使用正方形裁剪并开启拖动、缩放；组件会合并调用方配置。 */
export const defaultOptions: Cropper.Options = {
  aspectRatio: 1,
  zoomable: true,
  zoomOnTouch: true,
  zoomOnWheel: true,
  cropBoxMovable: true,
  cropBoxResizable: true,
  toggleDragModeOnDblclick: true,
  autoCrop: true,
  background: true,
  highlight: true,
  center: true,
  responsive: true,
  restore: true,
  checkCrossOrigin: true,
  checkOrientation: true,
  scalable: true,
  modal: true,
  guides: true,
  movable: true,
  rotatable: true,
};

export type { Cropper as CropperType };
