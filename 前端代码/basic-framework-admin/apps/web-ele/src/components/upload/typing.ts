/**
 * 上传组件的类型契约：定义上传状态枚举、列表展示类型与接口返回结构，
 * 以及 FileUpload 的全部属性，供上传组件与调用页共用。
 */
import type { AxiosResponse } from '@vben/request';

import type { AxiosProgressEvent } from '#/api/core/file';

/** 上传结果状态枚举 */
export enum UploadResultStatus {
  DONE = 'done',
  ERROR = 'error',
  SUCCESS = 'success',
  UPLOADING = 'uploading',
}

/** 文件上传列表的显示类型 */
export type UploadListType = 'picture' | 'picture-card' | 'text';

/**
 * 上传接口返回体：data 是新增后的文件地址，url 是可直接访问的完整地址，
 * 其余键由后端业务自行附加，上传组件不解析。
 */
export interface UploadApiPayload {
  data?: string;
  url?: string;
  [key: string]: unknown;
}

/**
 * 上传接口允许的返回形态：完整 Axios 响应、去掉包装的返回体或直接是地址字符串。
 * use-upload-core 会把这三种形态统一收敛成文件地址字符串。
 */
export type UploadApiResult =
  | AxiosResponse<UploadApiPayload>
  | string
  | UploadApiPayload;

/** 文件上传组件属性 */
export interface FileUploadProps {
  accept?: string[]; // 根据后缀，或者其他
  api?: (
    file: File,
    onUploadProgress?: AxiosProgressEvent,
  ) => Promise<UploadApiResult>;
  directory?: string; // 上传的目录
  disabled?: boolean;
  drag?: boolean; // 是否支持拖拽上传
  helpText?: string;
  listType?: UploadListType;
  maxNumber?: number; // 最大数量的文件，Infinity 不限制
  modelValue?: string | string[]; // v-model 支持
  maxSize?: number; // 文件最大多少 MB
  multiple?: boolean; // 是否支持多选
  resultField?: string; // support xxx.xxx.xx
  showDescription?: boolean; // 是否显示下面的描述
  value?: string | string[];
}
