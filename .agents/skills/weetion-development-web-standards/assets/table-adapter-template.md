# 表格适配器配置模板

## 模板用途
用于生成 CRUD 页面的表格适配器配置模板

## 适配器说明

当前管理应用已在 `apps/web-ele/src/adapter/vxe-table.ts` 统一注册表格、分页响应和渲染器。普通 CRUD 从 `#/adapter/vxe-table` 导入，不重复执行全局初始化。以下仅供明确需要修改适配层时参考，响应字段对齐后端 `PageResult` 的 `list`、`total`，组件使用 Element Plus：

```typescript
import { h } from 'vue';

import { setupVbenVxeTable, useVbenVxeGrid } from '@vben/plugins/vxe-table';

import { ElButton, ElImage } from 'element-plus';

import { useVbenForm } from './form';

setupVbenVxeTable({
  /** 注册统一分页与渲染器，影响所有使用该适配器的页面。 */
  configVxeTable: (vxeUI) => {
    vxeUI.setConfig({
      grid: {
        align: 'center',
        border: false,
        columnConfig: {
          resizable: true,
        },
        minHeight: 180,
        formConfig: {
          // 全局禁用 vxe-table 表单配置，改用 formOptions
          enabled: false,
        },
        proxyConfig: {
          autoLoad: true,
          response: {
            result: 'list',
            total: 'total',
          },
          showActiveMsg: true,
          showResponseMsg: false,
        },
        round: true,
        showOverflow: true,
        size: 'small',
      },
    });

    // 表格配置中可使用 cellRender: { name: 'CellImage' }
    vxeUI.renderer.add('CellImage', {
      /** 按列字段显示当前行图片。 */
      renderTableDefault(_renderOpts, params) {
        const { column, row } = params;
        return h(ElImage, { src: row[column.field] });
      },
    });

    // 表格配置中可使用 cellRender: { name: 'CellLink' }
    vxeUI.renderer.add('CellLink', {
      /** 将渲染器文案展示为链接风格按钮。 */
      renderTableDefault(renderOpts) {
        const { props } = renderOpts;
        return h(
          ElButton,
          { size: 'small', link: true },
          { default: () => props?.text },
        );
      },
    });

    // 可在此扩展 vxe-table 全局配置，例如自定义格式化
    // vxeUI.formats.add
  },
  useVbenForm,
});

export { useVbenVxeGrid };

export type * from '@vben/plugins/vxe-table';
```
