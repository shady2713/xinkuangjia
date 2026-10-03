import type { VxeTableGridOptions } from '@vben/plugins/vxe-table';
import type { Recordable } from '@vben/types';

import { h } from 'vue';

import { IconifyIcon } from '@vben/icons';
import { $te } from '@vben/locales';
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
  isFunction,
  isString,
} from '@vben/utils';

import { ElButton, ElImage, ElPopconfirm, ElSwitch, ElTag } from 'element-plus';

import { DictTag } from '#/components/dict-tag';
import { $t } from '#/locales';

import { useVbenForm } from './form';

setupVbenVxeTable({
  /**
   * 收敛本应用对 vxe-table 的全部全局定制：表格默认行为、单元格渲染器和表单行为。
   * 集中在一处配置，避免各业务页面各自改动全局渲染器造成互相覆盖。
   * @param vxeUI vxe-table 的全局配置与渲染器注册入口。
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
          // 全局禁用vxe-table的表单配置，使用formOptions
          enabled: false,
        },
        toolbarConfig: {
          import: false, // 是否导入
          export: false, // 是否导出
          refresh: false, // 列表工具栏不再展示刷新入口
          print: false, // 是否打印
          zoom: false, // 列表工具栏不再展示全屏缩放入口
          custom: false, // 列表工具栏不再展示列设置入口
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

    // 表格配置项可以用 cellRender: { name: 'CellImage' },
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

    // 表格配置项可以用 cellRender: { name: 'CellLink' },
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

    // 表格配置项可以用 cellRender: { name: 'CellTag' },
    vxeUI.renderer.add('CellTag', {
      renderTableDefault(renderOpts, params) {
        const { props } = renderOpts;
        const { column, row } = params;
        return h(ElTag, { color: props?.color }, () => row[column.field]);
      },
    });

    vxeUI.renderer.add('CellTags', {
      /**
       * 把该列的标签数组渲染成一组居中排列的 ElTag。
       * @param renderOpts 渲染器上下文，props.color 为标签配色。
       * @param params 当前行列信息，用于取该列的值。
       * @returns 标签组；该列为空或非数组时返回空串。
       */
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
            /**
             * 该列的值约定为标签数组；非数组时按空列表处理，避免渲染期抛错。
             * @returns 逐个渲染的 ElTag 节点数组。
             */
            default: () =>
              (Array.isArray(row[column.field])
                ? (row[column.field] as unknown[])
                : []
              ).map(
                /**
                 * 单个标签渲染为一个 ElTag；元素类型未知，统一按文本展示。
                 * @param item 标签数组中的一个元素，来源由该列数据决定。
                 * @returns 该标签对应的 ElTag 虚拟节点。
                 */
                (item: unknown) =>
                  h(
                    ElTag,
                    { color: props?.color },
                    {
                      /**
                       * 标签正文只接受字符串，未知元素在此处收敛为文本。
                       * @returns 标签显示文本。
                       */
                      default: () => String(item),
                    },
                  ),
              ),
          },
        );
      },
    });

    // 表格配置项可以用 cellRender: { name: 'CellDict', props:{dictType: ''} },
    vxeUI.renderer.add('CellDict', {
      renderTableDefault(renderOpts, params) {
        const { props } = renderOpts;
        const { column, row } = params;
        if (!props) {
          return '';
        }
        // 使用 DictTag 组件替代原来的实现
        return h(DictTag, {
          type: props.type,
          value: row[column.field]?.toString(),
        });
      },
    });

    // 表格配置项可以用 cellRender: { name: 'CellSwitch', props: { beforeChange: () => {} } },
    // Adapted from an earlier internal implementation.
    vxeUI.renderer.add('CellSwitch', {
      /**
       * 把该列渲染成带确认文案的开关，变更时走 beforeChange 钩子。
       * @param context 渲染器上下文。
       * @param context.attrs 外部透传属性，beforeChange 在此。
       * @param context.props 列上配置的固定属性，会覆盖内置文案与取值。
       * @param rowInfo 当前行列信息。
       * @param rowInfo.column 当前列定义。
       * @param rowInfo.row 当前行数据，变更后直接写回。
       * @returns ElSwitch 节点。
       */
      renderTableDefault({ attrs, props }, { column, row }) {
        const loadingKey = `__loading_${column.field}`;
        const finallyProps = {
          inlinePrompt: true,
          activeText: $t('common.enabled'),
          inactiveText: $t('common.disabled'),
          activeValue: 1,
          inactiveValue: 0,
          ...props,
          modelValue: row[column.field],
          loading: row[loadingKey] ?? false,
          'onUpdate:modelValue': onChange,
        };

        /**
         * 开关变更回调：先置 loading，允许 beforeChange 拦截后再写回行数据。
         * @param newVal 开关的新值，取自 activeValue / inactiveValue。
         */
        async function onChange(newVal: unknown) {
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

    // 注册表格的操作按钮渲染器 cellRender: { name: 'CellOperation', options: ['edit', 'delete'] }
    // Adapted from an earlier internal implementation.
    vxeUI.renderer.add('CellOperation', {
      /**
       * 渲染操作列的默认内容：把配置里的操作项翻译成按钮，删除项额外加二次确认。
       * @param context 渲染器收到的上下文，提供当前行触发的事件回调。
       * @param context.attrs 组件透传属性，本实现未使用。
       * @param context.options 列上配置的操作项清单。
       * @param context.props 列上配置的固定按钮属性。
       * @param rowInfo 当前行列信息。
       * @param rowInfo.column 当前列定义，align 决定按钮组的对齐方式。
       * @param rowInfo.row 当前行数据，用于生成二次确认文案。
       * @returns 操作列的渲染结果。
       */
      renderTableDefault({ attrs, options, props }, { column, row }) {
        const defaultProps = {
          type: 'primary',
          class: '!p-0',
          ...props,
        };
        let align = 'end';
        switch (column.align) {
          case 'center': {
            align = 'center';
            break;
          }
          case 'left': {
            align = 'start';
            break;
          }
          default: {
            align = 'end';
            break;
          }
        }
        const presets: Recordable<Recordable<unknown>> = {
          delete: {
            type: 'danger',
            text: $t('common.delete'),
          },
          edit: {
            text: $t('common.edit'),
          },
        };
        const operations: Array<Recordable<unknown>> = (
          options || ['edit', 'delete']
        )
          .map((opt) => {
            if (isString(opt)) {
              return presets[opt]
                ? { code: opt, ...presets[opt], ...defaultProps }
                : {
                    code: opt,
                    text: $te(`common.${opt}`) ? $t(`common.${opt}`) : opt,
                    ...defaultProps,
                  };
            } else {
              return { ...defaultProps, ...presets[opt.code], ...opt };
            }
          })
          .map(
            /**
             * 归一化操作项：函数型属性推迟到拿到当前行后再求值，
             * 这样 show、disabled 才能依赖行数据，而不是在配置期就被固定。
             * @param opt 单个操作项配置。
             * @returns 求值后的操作项，函数型属性已替换为基于当前行的结果。
             */
            (opt) => {
              const optBtn: Recordable<unknown> = {};
              Object.keys(opt).forEach(
                /**
                 * 逐个属性求值：函数型属性传入当前行，其余属性原样保留。
                 * @param key 当前操作项的属性名。
                 */
                (key) => {
                  optBtn[key] = isFunction(opt[key]) ? opt[key](row) : opt[key];
                },
              );
              return optBtn;
            },
          )
          .filter((opt) => opt.show !== false);

        /**
         * 渲染单个操作按钮。
         * @param opt 已求值的操作项配置，决定按钮文案、图标与危险样式。
         * @param listen 是否绑定点击回调；二次确认弹层的触发按钮传 false，避免重复触发。
         * @returns 按钮的渲染结果。
         */
        function renderBtn(opt: Recordable<unknown>, listen = true) {
          return h(
            ElButton,
            {
              ...props,
              ...opt,
              link: true,
              icon: undefined,
              onClick: listen
                ? () =>
                    attrs?.onClick?.({
                      code: opt.code,
                      row,
                    })
                : undefined,
            },
            {
              /**
               * 渲染按钮内容：只有 icon 确实是字符串时才当作图标名渲染，避免渲染出无效图标节点。
               * @returns 图标节点与文案的组合。
               */
              default: () => {
                const content = [];
                // opt 来自配置包，icon 形状不可控，只在确实是图标名时才渲染图标。
                if (typeof opt.icon === 'string') {
                  content.push(
                    h(IconifyIcon, { class: 'size-5', icon: opt.icon }),
                  );
                }
                content.push(opt.text);
                return content;
              },
            },
          );
        }

        /**
         * 渲染带二次确认的删除操作。
         * 确认后才回调事件，避免误点直接删数据。
         * @param opt 已求值的操作项配置，提供按钮文案与操作码。
         * @returns 气泡确认框的渲染结果。
         */
        function renderConfirm(opt: Recordable<unknown>) {
          return h(
            ElPopconfirm,
            {
              title: $t('ui.actionTitle.delete', [attrs?.nameTitle || '']),
              width: 'auto',
              'popper-class': 'popper-top-left',
              onConfirm: () => {
                attrs?.onClick?.({
                  code: opt.code,
                  row,
                });
              },
            },
            {
              reference: () => renderBtn({ ...opt }, false),
              default: () =>
                h(
                  'div',
                  { class: 'truncate' },
                  $t('ui.actionMessage.deleteConfirm', [
                    row[attrs?.nameField || 'name'],
                  ]),
                ),
            },
          );
        }

        const btns = operations.map((opt) =>
          opt.code === 'delete' ? renderConfirm(opt) : renderBtn(opt),
        );
        return h(
          'div',
          {
            class: 'flex table-operations',
            style: { justifyContent: align },
          },
          btns,
        );
      },
    });

    // 这里可以自行扩展 vxe-table 的全局配置，比如自定义格式化
    // vxeUI.formats.add

    vxeUI.formats.add('formatPast2', {
      tableCellFormatMethod({ cellValue }) {
        return formatPast2(cellValue);
      },
    });

    // add by 星语：数量格式化，保留 3 位
    vxeUI.formats.add('formatAmount3', {
      tableCellFormatMethod({ cellValue }) {
        if (cellValue === null || cellValue === undefined) {
          return '';
        }
        return erpCountInputFormatter(cellValue);
      },
    });
    // add by 星语：数量格式化，保留 2 位
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

    // add by 星语：文件大小格式化
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
