import type { VxeTableGridOptions } from '@vben/plugins/vxe-table';

import { h } from 'vue';

import {
  AsyncVxeColumn,
  AsyncVxeTable,
  createRequiredValidation,
  setupVbenVxeTable,
  useVbenVxeGrid,
} from '@vben/plugins/vxe-table';
import {
  erpCountInputFormatter,
  erpNumberFormatter,
  fenToYuan,
  formatFileSize,
  formatPast2,
} from '@vben/utils';

import { ElButton, ElImage, ElSwitch, ElTag } from 'element-plus';

import { DictTag } from '#/components/dict-tag';
import { $t } from '#/locales';

import { useVbenForm } from './form';

setupVbenVxeTable({
  /**
   * 配置管理端 VxeTable 默认布局、分页响应字段、单元格渲染器与格式化器。
   *
   * @param vxeUI VxeUI 核心实例
   */
  configVxeTable: (vxeUI) => {
    vxeUI.setConfig({
      table: {
        resizableConfig: {
          maxWidth: 1000,
        },
      },
      grid: {
        align: 'center',
        border: false,
        columnConfig: {
          resizable: true,
        },
        minHeight: 180,
        formConfig: {
          enabled: false,
        },
        toolbarConfig: {
          import: false,
          export: false,
          refresh: false,
          print: false,
          zoom: false,
          custom: false,
        },
        customConfig: {
          mode: 'modal',
        },
        proxyConfig: {
          autoLoad: true,
          // 开启代理分页序号偏移，由 VXE 按当前页和每页条数连续计算序号，避免翻页后重新从 1 开始。
          seq: true,
          response: {
            result: 'list',
            total: 'total',
          },
          showActiveMsg: true,
          showResponseMsg: false,
        },
        pagerConfig: {
          enabled: true,
        },
        sortConfig: {
          multiple: true,
        },
        round: true,
        showOverflow: true,
        size: 'small',
      } as VxeTableGridOptions,
    });

    vxeUI.renderer.add('CellImage', {
      renderTableDefault(renderOpts, params) {
        const { props } = renderOpts;
        const { column, row } = params;
        const src = row[column.field];
        return h(ElImage, {
          src,
          previewSrcList: [src],
          class: props?.class,
          style: {
            width: props?.width ? `${props.width}px` : undefined,
            height: props?.height ? `${props.height}px` : undefined,
          },
          previewTeleported: true,
        });
      },
    });

    vxeUI.renderer.add('CellLink', {
      renderTableDefault(renderOpts) {
        const { props } = renderOpts;
        return h(
          ElButton,
          { size: 'small', link: true },
          { default: () => props?.text },
        );
      },
    });

    vxeUI.renderer.add('CellTag', {
      renderTableDefault(renderOpts, params) {
        const { props } = renderOpts;
        const { column, row } = params;
        return h(ElTag, { color: props?.color }, () => row[column.field]);
      },
    });

    vxeUI.renderer.add('CellTags', {
      renderTableDefault(renderOpts, params) {
        const { props } = renderOpts;
        const { column, row } = params;
        if (!row[column.field] || row[column.field].length === 0) {
          return '';
        }
        return h(
          'div',
          { class: 'flex items-center justify-center' },
          {
            default: () =>
              row[column.field].map((item: any) =>
                h(ElTag, { color: props?.color }, { default: () => item }),
              ),
          },
        );
      },
    });

    vxeUI.renderer.add('CellDict', {
      /**
       * 渲染字典标签单元格。
       *
       * @param renderOpts 单元格渲染选项
       * @param params 行列上下文参数
       * @returns 字典标签 VNode 或空字符串
       */
      renderTableDefault(renderOpts, params) {
        const { props } = renderOpts;
        const { column, row } = params;
        if (!props) {
          return '';
        }
        return h(DictTag, {
          type: props.type,
          value: row[column.field]?.toString(),
        });
      },
    });

    vxeUI.renderer.add('CellSwitch', {
      /**
       * 渲染带异步确认钩子的状态开关单元格。
       *
       * @param renderOpts 单元格渲染属性与事件配置
       * @param renderOpts.attrs 附加事件回调（含 beforeChange）
       * @param renderOpts.props ElSwitch 组件属性
       * @param params 行列上下文参数
       * @param params.column 当前列定义
       * @param params.row 当前行数据
       * @returns 状态开关虚拟节点
       */
      renderTableDefault({ attrs, props }, { column, row }) {
        const loadingKey = `__loading_${column.field}`;
        const finallyProps = {
          inlinePrompt: true,
          activeText: $t('common.enabled'),
          inactiveText: $t('common.disabled'),
          // 与后端 CommonStatusEnum 对齐：0 启用、1 停用。
          activeValue: 0,
          inactiveValue: 1,
          ...props,
          modelValue: row[column.field],
          loading: row[loadingKey] ?? false,
          'onUpdate:modelValue': onChange,
        };

        /** 调用外部确认钩子并在通过后更新单元格开关值。 */
        async function onChange(newVal: any) {
          row[loadingKey] = true;
          try {
            const result = await attrs?.beforeChange?.(newVal, row);
            if (result !== false) {
              row[column.field] = newVal;
            }
          } finally {
            row[loadingKey] = false;
          }
        }

        return h(ElSwitch, finallyProps);
      },
    });

    vxeUI.formats.add('formatPast2', {
      tableCellFormatMethod({ cellValue }) {
        return formatPast2(cellValue);
      },
    });

    vxeUI.formats.add('formatAmount3', {
      tableCellFormatMethod({ cellValue }) {
        if (cellValue === null || cellValue === undefined) {
          return '';
        }
        return erpCountInputFormatter(cellValue);
      },
    });

    vxeUI.formats.add('formatAmount2', {
      tableCellFormatMethod({ cellValue }, digits = 2) {
        return `${erpNumberFormatter(cellValue, digits)}`;
      },
    });

    vxeUI.formats.add('formatFenToYuanAmount', {
      tableCellFormatMethod({ cellValue }, digits = 2) {
        return `${erpNumberFormatter(fenToYuan(cellValue), digits)}`;
      },
    });

    vxeUI.formats.add('formatFileSize', {
      tableCellFormatMethod({ cellValue }, digits = 2) {
        return formatFileSize(cellValue, digits);
      },
    });
  },
  useVbenForm,
});

export { createRequiredValidation, useVbenVxeGrid };

export const [VxeTable, VxeColumn] = [AsyncVxeTable, AsyncVxeColumn];

export * from '#/components/table-action';

export type * from '@vben/plugins/vxe-table';
