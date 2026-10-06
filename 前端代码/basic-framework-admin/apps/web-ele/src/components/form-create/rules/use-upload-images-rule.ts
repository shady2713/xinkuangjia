/** 多图上传组件的设计器规则：属性面板暴露图片类型、数量上限与缩略图尺寸。 */
import type { FormCreatePropsContext } from '#/components/form-create/typing';

import { buildUUID } from '@vben/utils';

import {
  localeProps,
  makeRequiredRule,
} from '#/components/form-create/helpers';

/**
 * 多图上传组件规则
 * @returns form-create 设计器注册项；rule 生成表单规则，props 生成属性面板配置行
 */
export function useUploadImagesRule() {
  const label = '多图上传';
  const name = 'ImagesUpload';
  return {
    icon: 'icon-image',
    label,
    name,
    /**
     * 生成多图上传组件在设计器画布上的表单规则。
     * 字段名用 UUID 而不是标题，避免同一画布放多个多图上传组件时绑定名互相覆盖。
     * @returns 该组件的表单规则对象，默认非必填，数量上限由属性面板配置。
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
     * 生成多图上传组件的属性面板配置行。
     * @param _name form-create 传入的目标组件名，本工程按闭包中的 name 取配置故不使用
     * @param context 设计器上下文，只取其中的 t 翻译函数
     * @returns 已完成文案国际化的属性面板配置行数组
     */
    props(_name: string, context: FormCreatePropsContext) {
      const { t } = context;
      return localeProps(t, `${name}.props`, [
        makeRequiredRule(),
        {
          type: 'switch',
          field: 'drag',
          title: '拖拽上传',
          value: false,
        },
        {
          type: 'select',
          field: 'fileType',
          title: '图片类型限制',
          value: ['image/jpeg', 'image/png', 'image/gif'],
          options: [
            { label: 'image/apng', value: 'image/apng' },
            { label: 'image/bmp', value: 'image/bmp' },
            { label: 'image/gif', value: 'image/gif' },
            { label: 'image/jpeg', value: 'image/jpeg' },
            { label: 'image/pjpeg', value: 'image/pjpeg' },
            { label: 'image/svg+xml', value: 'image/svg+xml' },
            { label: 'image/tiff', value: 'image/tiff' },
            { label: 'image/webp', value: 'image/webp' },
            { label: 'image/x-icon', value: 'image/x-icon' },
          ],
          props: {
            multiple: true,
            maxNumber: 5,
          },
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
          type: 'input',
          field: 'height',
          title: '组件高度',
          value: '150px',
        },
        {
          type: 'input',
          field: 'width',
          title: '组件宽度',
          value: '150px',
        },
        {
          type: 'input',
          field: 'borderradius',
          title: '组件边框圆角',
          value: '8px',
        },
      ]);
    },
  };
}
