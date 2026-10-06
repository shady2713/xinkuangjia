/**
 * 个人中心组件共享类型：Props 描述页面外壳的入参，
 * FormSchemaItem 与 SettingProps 描述开关表单的字段与取值。
 *
 * 只覆盖组件间传参，请求模型与业务字段映射由使用方应用定义。
 */
import type { BasicUserInfo } from '@vben/types';

export interface Props {
  title?: string;
  userInfo: BasicUserInfo | null;
  tabs: {
    label: string;
    value: string;
  }[];
}

export interface FormSchemaItem {
  description: string;
  fieldName: string;
  label: string;
  value: boolean;
}

export interface SettingProps {
  formSchema: FormSchemaItem[];
}
