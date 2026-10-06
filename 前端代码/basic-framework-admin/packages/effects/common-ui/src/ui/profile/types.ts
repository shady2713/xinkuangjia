/**
 * 个人中心组件共享类型：Props 描述页面外壳的入参，
 * FormSchemaItem 与 SettingProps 描述开关表单的字段与取值。
 *
 * 只覆盖组件间传参，请求模型与业务字段映射由使用方应用定义。
 */
import type { BasicUserInfo } from '@vben/types';

/** 个人中心页面外壳属性：标题、当前用户信息与标签页清单。 */
export interface Props {
  title?: string;
  userInfo: BasicUserInfo | null;
  tabs: {
    label: string;
    value: string;
  }[];
}

/** 开关表单的单个字段：字段名、标签与说明文案，以及当前开关值。 */
export interface FormSchemaItem {
  description: string;
  fieldName: string;
  label: string;
  value: boolean;
}

/** 开关表单属性：字段清单，取值与变更由使用方以双向绑定维护。 */
export interface SettingProps {
  formSchema: FormSchemaItem[];
}
