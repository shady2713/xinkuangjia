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

export interface UploadApiPayload {
  data?: string;
  url?: string;
  [key: string]: unknown;
}

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
