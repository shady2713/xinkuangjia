/** 网页 iframe 组件的设计器规则：属性面板额外暴露加载方式与 sandbox 安全限制。 */
import type { FormCreatePropsContext } from '#/components/form-create/typing';

import { buildUUID } from '@vben/utils';

import {
  localeProps,
  makeRequiredRule,
} from '#/components/form-create/helpers';

/**
 * iframe 组件规则
 * @returns form-create 设计器注册项；rule 生成表单规则，props 生成属性面板配置行
 */
export function useIframeRule() {
  const label = '网页 iframe';
  const name = 'IframeComponent';

  return {
    icon: 'icon-link',
    label,
    name,
    rule() {
      return {
        type: name,
        field: buildUUID(),
        title: label,
        info: '',
        $required: false,
        modelField: 'model-value', // 当前表单运行时使用 model-value 作为字段绑定名
      };
    },
    /**
     * 生成 iframe 组件的属性面板配置行。
     * @param _name form-create 传入的目标组件名，本工程按闭包中的 name 取配置故不使用
     * @param context 设计器上下文，只取其中的 t 翻译函数
     * @returns 已完成文案国际化的属性面板配置行数组
     */
    props(_name: string, context: FormCreatePropsContext) {
      const { t } = context;
      return localeProps(t, `${name}.props`, [
        makeRequiredRule(),
        {
          type: 'input',
          field: 'url',
          title: 'URL 地址',
          value: '',
          info: '请输入完整的 HTTP 或 HTTPS 地址',
        },
        {
          type: 'input',
          field: 'height',
          title: 'iframe 高度',
          value: '500px',
          info: '支持 px、%、vh 等单位',
        },
        {
          type: 'input',
          field: 'width',
          title: 'iframe 宽度',
          value: '100%',
          info: '支持 px、%、vw 等单位',
        },
        {
          type: 'select',
          field: 'loading',
          title: '加载方式',
          value: 'lazy',
          options: [
            { label: '懒加载', value: 'lazy' },
            { label: '立即加载', value: 'eager' },
          ],
        },
        {
          type: 'switch',
          field: 'allowfullscreen',
          title: '允许全屏',
          value: true,
        },
        {
          type: 'input',
          field: 'sandbox',
          title: 'sandbox 属性',
          value: '',
          info: '安全沙箱限制，如：allow-scripts allow-same-origin',
        },
      ]);
    },
  };
}
