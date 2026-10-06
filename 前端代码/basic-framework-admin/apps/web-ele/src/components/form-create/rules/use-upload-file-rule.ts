/** 文件上传组件的设计器规则：属性面板暴露文件类型、体积与数量限制。 */
import type { FormCreatePropsContext } from '#/components/form-create/typing';

import { buildUUID } from '@vben/utils';

import {
  localeProps,
  makeRequiredRule,
} from '#/components/form-create/helpers';

/**
 * 文件上传组件规则
 * @returns form-create 设计器注册项；rule 生成表单规则，props 生成属性面板配置行
 */
export function useUploadFileRule() {
  const label = '文件上传';
  const name = 'FileUpload';
  return {
    icon: 'icon-upload',
    label,
    name,
    /**
     * 生成文件上传组件在设计器画布上的表单规则。
     * 字段名用 UUID 而不是标题，避免同一画布放多个上传组件时绑定名互相覆盖。
     * @returns 该组件的表单规则对象，默认非必填，具体限制由属性面板配置。
     */
    rule() {
      return {
        type: name,
        field: buildUUID(),
        title: label,
        info: '',
        $required: false,
      };
    },
    /**
     * 生成文件上传组件的属性面板配置行。
     * @param _name form-create 传入的目标组件名，本工程按闭包中的 name 取配置故不使用
     * @param context 设计器上下文，只取其中的 t 翻译函数
     * @returns 已完成文案国际化的属性面板配置行数组
     */
    props(_name: string, context: FormCreatePropsContext) {
      const { t } = context;
      return localeProps(t, `${name}.props`, [
        makeRequiredRule(),
        {
          type: 'select',
          field: 'fileType',
          title: '文件类型',
          value: ['doc', 'xls', 'ppt', 'txt', 'pdf'],
          options: [
            { label: 'doc', value: 'doc' },
            { label: 'xls', value: 'xls' },
            { label: 'ppt', value: 'ppt' },
            { label: 'txt', value: 'txt' },
            { label: 'pdf', value: 'pdf' },
          ],
          props: {
            multiple: true,
          },
        },
        {
          type: 'switch',
          field: 'autoUpload',
          title: '是否在选取文件后立即进行上传',
          value: true,
        },
        {
          type: 'switch',
          field: 'drag',
          title: '拖拽上传',
          value: false,
        },
        {
          type: 'switch',
          field: 'isShowTip',
          title: '是否显示提示',
          value: true,
        },
        {
          type: 'inputNumber',
          field: 'fileSize',
          title: '大小限制(MB)',
          value: 5,
          props: { min: 0 },
        },
        {
          type: 'inputNumber',
          field: 'limit',
          title: '数量限制',
          value: 5,
          props: { min: 0 },
        },
        {
          type: 'switch',
          field: 'disabled',
          title: '是否禁用',
          value: false,
        },
      ]);
    },
  };
}
