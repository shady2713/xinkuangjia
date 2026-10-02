# Vben Vxe Table

框架提供了基于 vxe-table 的 Table 组件，并结合 Vben Form 进行了二次封装。

头部的搜索表单使用 Vben Form，表体使用 vxe-grid 组件，支持分页、排序、过滤等功能。

参数细节查阅 [VXE Grid 官方 API](https://vxetable.cn/v4/#/grid/api)，并以当前安装版本的类型和实现核对适用性。

**具体使用示例和代码模板请参考**：[对应模板](../assets/table-usage-template.md)

## 重要说明

如果现有组件封装无法满足需求，可以使用原生组件或自行封装自定义组件。框架提供的组件并非强制使用，请根据实际需求选择。

## 适配器

表格使用 vxe-table 实现，因此可以使用 vxe-table 的所有功能。针对不同的 UI 框架，我们提供了适配器以实现更好的兼容性。

**具体适配器配置和代码示例请参考**：[对应模板](../assets/table-adapter-template.md)

## 搜索表单

搜索表单使用 Vben Form，请参考 Vben Form 文档。

启用搜索表单后，可以在 toolbarConfig 中配置 search 为 true，在工具栏区域显示搜索表单控制按钮。所有名称以 form- 开头的插槽都会传递给搜索表单。

## 自定义分隔条

启用搜索表单后，表单与表格之间会显示一个分隔条。该分隔条使用默认的组件背景色，横向贯穿整个 Vben Vxe Table，与页面默认背景融为一体。如果将 Vben Vxe Table 包裹在不同背景色的容器中（例如放在 Card 中），表单与表格之间的默认分隔条可能会显得不协调。下面的代码演示了如何自定义该分隔条。

```typescript
const [Grid] = useVbenVxeGrid({
  formOptions: {},
  gridOptions: {},
  // 完全移除分隔条
  separator: false,
  // 也可以使用以下代码移除分隔条
  // separator: { show: false },
  // 或者使用以下代码修改分隔条颜色
  // separator: { backgroundColor: 'rgba(100,100,0,0.5)' },
});
```

## API

useVbenVxeGrid 返回一个数组，第一个元素是表格组件，第二个元素是表格方法。

```vue
<script setup lang="ts">
import { useVbenVxeGrid } from '#/adapter/vxe-table';

// Grid 是表格组件
// gridApi 是表格方法
const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {},
  formOptions: {},
  gridEvents: {},
  // 属性
  // 事件
});
</script>

<template>
  <Grid />
</template>
```

## GridApi 方法

useVbenVxeGrid 返回的第二个参数是一个对象，包含一些表格方法。

### setLoading
- **说明**：设置加载状态
- **类型**：`(loading: boolean) => void`

### setGridOptions
- **说明**：设置 vxe-table grid 组件参数
- **类型**：`(options: Partial<VxeGridProps['gridOptions']>) => void`

### reload
- **说明**：重新加载表格，会重新初始化
- **类型**：`(params?: any) => void`

### query
- **说明**：重新加载表格，会保持当前分页
- **类型**：`(params?: any) => void`

### grid
- **说明**：vxe-table grid 实例
- **类型**：`VxeGridInstance`

### formApi
- **说明**：vbenForm api 实例
- **类型**：`FormApi`

### toggleSearchForm
- **说明**：设置搜索表单显示状态
- **类型**：`(show?: boolean) => boolean`
- **备注**：省略参数时，表单会在显示与隐藏状态之间切换

## Props 配置

所有属性都可以传递给 useVbenVxeGrid 的第一个参数。

### tableTitle
- **类型**：`string`
- **说明**：表格标题

### tableTitleHelp
- **类型**：`string`
- **说明**：表格标题帮助信息

### gridClass
- **类型**：`string`
- **说明**：Grid 组件类名

### gridOptions
- **类型**：`VxeTableGridProps`
- **说明**：Grid 组件参数

### gridEvents
- **类型**：`VxeGridListeners`
- **说明**：Grid 组件触发的事件

### formOptions
- **类型**：`VbenFormProps`
- **说明**：表单参数

### showSearchForm
- **类型**：`boolean`
- **默认值**：`false`
- **说明**：是否显示搜索表单

### separator
- **类型**：`boolean | SeparatorOptions`
- **默认值**：`true`
- **版本**：>5.5.4
- **说明**：搜索表单与表体之间的分隔条

### showToolbar
- **类型**：`boolean`
- **默认值**：`true`
- **说明**：是否显示工具栏

## 插槽

大部分插槽说明可查阅 vxe-table 官方文档，但工具栏部分经过了定制，需要通过以下插槽自定义表格工具栏：

### toolbar-actions
- **说明**：工具栏左侧（靠近表格标题）

### toolbar-tools
- **说明**：工具栏右侧（vxeTable 原生工具按钮的左侧）

### table-title
- **说明**：表格标题插槽

### 搜索表单插槽

对于使用搜索表单的表格，所有名称以 form- 开头的插槽都会传递给表单。

## 单元格编辑

将 editConfig.mode 指定为 cell，即可实现单元格编辑。

```typescript
  editConfig: {
    mode: 'cell',
    trigger: 'click',
  },
```

## 行编辑

将 editConfig.mode 指定为 row，即可实现行编辑。

```typescript
  editConfig: {
    mode: 'row',
    trigger: 'click',
  },
```

## 树形表格

树形表格的数据源是扁平结构。可以通过指定 treeConfig 配置实现树形表格。

```typescript
treeConfig: {
  transform: true, // 指定表格为树形表格
  parentField: 'parentId', // 父节点字段名
  rowField: 'id', // 行数据字段名
},
```

## 固定表头/列

列固定的可选参数：`'left' | 'right' | '' | null`

## 自定义单元格

实现自定义单元格有两种方式：

1. 通过插槽
2. 通过 `cellRender` 引用已注册渲染器。当前应用已有 `CellImage`、`CellLink` 等渲染器，普通页面直接使用；下列注册片段仅放在适配器的 `configVxeTable(vxeUI)` 回调中，不重复初始化全局适配器。

```typescript
import { h } from 'vue';
import { ElButton, ElImage } from 'element-plus';

// 表格配置中可以使用 cellRender: { name: 'CellImage' }
vxeUI.renderer.add('CellImage', {
  /** 使用当前应用的图片组件显示列对应的图片地址。 */
  renderTableDefault(_renderOpts, params) {
    const { column, row } = params;
    return h(ElImage, { src: row[column.field] });
  },
});

// 表格配置中可以使用 cellRender: { name: 'CellLink' }
vxeUI.renderer.add('CellLink', {
  /** 将配置中的文本显示为 Element Plus 链接按钮。 */
  renderTableDefault(renderOpts) {
    const { props } = renderOpts;
    return h(
      ElButton,
      { size: 'small', link: true },
      { default: () => props?.text },
    );
  },
});
```

## 虚拟滚动

通过 `gridOptions.virtualYConfig` 配置纵向虚拟滚动：`enabled` 为总开关，`gt` 为行数阈值；总行数大于阈值时启用，`gt: 0` 表示对任意非空数据启用。需给出适合业务的表格高度或高度约束。当前安装版本仍兼容已废弃的 `scrollY`，新示例使用 `virtualYConfig`。

查阅已验证的 [VXE Grid 官方 API](https://vxetable.cn/v4/#/grid/api)，检索 `virtualYConfig` 的版本说明和参数；组合示例见[表格模板](../assets/table-usage-template.md#13-虚拟滚动)。
