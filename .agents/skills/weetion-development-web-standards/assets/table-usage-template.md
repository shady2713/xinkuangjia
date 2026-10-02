# 表格使用示例模板

当前应用为 Element Plus。代码块展示组合片段；业务回调、数据类型和实际接口需按目标模块补齐，不能把示例名称当作已有实现。

## 模板用途
用于生成 CRUD 页面的表格使用示例模板

## 1. 基础表格

### 最简表格

```vue
<template>
  <Grid />
</template>

<script setup lang="ts">
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      { field: 'name', title: 'Name' },
      { field: 'age', title: 'Age' },
      { field: 'email', title: 'Email' },
    ],
    data: [
      { name: 'Zhang San', age: 25, email: 'zhangsan@example.com' },
      { name: 'Li Si', age: 30, email: 'lisi@example.com' },
    ],
  },
});
</script>
```

## 2. 带搜索表单的表格

```vue
<template>
  <Grid />
</template>

<script setup lang="ts">
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  showSearchForm: true,
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'name',
        label: 'Name',
      },
      {
        component: 'Input',
        fieldName: 'email',
        label: 'Email',
      },
    ],
  },
  gridOptions: {
    columns: [
      { field: 'name', title: 'Name' },
      { field: 'age', title: 'Age' },
      { field: 'email', title: 'Email' },
    ],
    proxyConfig: {
      ajax: {
        /** 第二个参数为 Vben 搜索表单值，与分页参数一同提交。 */
        query: async ({ page }, formValues) => {
          // formValues 为搜索表单值
          return await fetchTableData({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
          });
        },
      },
    },
  },
});
</script>
```

## 3. 远程数据加载

```vue
<template>
  <Grid />
</template>

<script setup lang="ts">
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      { field: 'name', title: 'Name' },
      { field: 'age', title: 'Age' },
      { field: 'email', title: 'Email' },
    ],
    proxyConfig: {
      ajax: {
        query: async ({ page }) => {
          const response = await fetchTableData({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
          });
          return {
            list: response.list,
            total: response.total,
          };
        },
      },
    },
  },
});
</script>
```

## 4. 带操作列的表格

```vue
<template>
  <Grid>
    <template #action="{ row }">
      <ElButton link @click="handleEdit(row)">Edit</ElButton>
      <ElButton link type="danger" @click="handleDelete(row)">Delete</ElButton>
    </template>
  </Grid>
</template>

<script setup lang="ts">
import { ElButton } from 'element-plus';
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      { field: 'name', title: 'Name' },
      { field: 'age', title: 'Age' },
      { field: 'email', title: 'Email' },
      {
        field: 'action',
        title: 'Action',
        width: 200,
        slots: { default: 'action' },
      },
    ],
    proxyConfig: {
      ajax: {
        query: async ({ page }) => {
          return await fetchTableData({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
  },
});

const handleEdit = (row: any) => {
  console.log('Edit', row);
};

const handleDelete = (row: any) => {
  console.log('Delete', row);
};
</script>
```

## 5. 单元格编辑

```vue
<template>
  <Grid />
</template>

<script setup lang="ts">
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      {
        field: 'name',
        title: 'Name',
        editRender: { name: 'input' },
      },
      {
        field: 'age',
        title: 'Age',
        editRender: { name: 'input' },
      },
      { field: 'email', title: 'Email' },
    ],
    editConfig: {
      mode: 'cell',
      trigger: 'click',
    },
    data: [
      { name: 'Zhang San', age: 25, email: 'zhangsan@example.com' },
      { name: 'Li Si', age: 30, email: 'lisi@example.com' },
    ],
  },
});
</script>
```

## 6. 行编辑

```vue
<template>
  <Grid />
</template>

<script setup lang="ts">
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      {
        field: 'name',
        title: 'Name',
        editRender: { name: 'input' },
      },
      {
        field: 'age',
        title: 'Age',
        editRender: { name: 'input' },
      },
      { field: 'email', title: 'Email' },
    ],
    editConfig: {
      mode: 'row',
      trigger: 'click',
    },
    data: [
      { name: 'Zhang San', age: 25, email: 'zhangsan@example.com' },
      { name: 'Li Si', age: 30, email: 'lisi@example.com' },
    ],
  },
});
</script>
```

## 7. 树形表格

```vue
<template>
  <Grid />
</template>

<script setup lang="ts">
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      { field: 'name', title: 'Name', treeNode: true },
      { field: 'size', title: 'Size' },
      { field: 'type', title: 'Type' },
    ],
    treeConfig: {
      transform: true,
      parentField: 'parentId',
      rowField: 'id',
    },
    data: [
      { id: 1, name: 'Root', size: '-', type: 'Folder', parentId: null },
      { id: 2, name: 'Documents', size: '-', type: 'Folder', parentId: 1 },
      { id: 3, name: 'readme.md', size: '1KB', type: 'File', parentId: 2 },
    ],
  },
});
</script>
```

## 8. 固定列

```vue
<template>
  <Grid />
</template>

<script setup lang="ts">
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      { field: 'name', title: 'Name', fixed: 'left', width: 150 },
      { field: 'age', title: 'Age', width: 100 },
      { field: 'email', title: 'Email', width: 200 },
      { field: 'address', title: 'Address', width: 300 },
      { field: 'phone', title: 'Phone', width: 150 },
      { field: 'action', title: 'Action', fixed: 'right', width: 150 },
    ],
    data: [],
  },
});
</script>
```

## 9. 自定义单元格渲染（插槽方式）

```vue
<template>
  <Grid>
    <template #status="{ row }">
      <ElTag :type="row.status === 0 ? 'success' : 'danger'">
        {{ row.status === 0 ? 'Enabled' : 'Disabled' }}
      </ElTag>
    </template>
  </Grid>
</template>

<script setup lang="ts">
import { ElTag } from 'element-plus';
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      { field: 'name', title: 'Name' },
      {
        field: 'status',
        title: 'Status',
        slots: { default: 'status' },
      },
    ],
    data: [
      { name: 'Zhang San', status: 1 },
      { name: 'Li Si', status: 0 },
    ],
  },
});
</script>
```

## 10. 自定义单元格渲染（渲染器方式）

使用自定义渲染器前，需要先在适配器中注册（参考[适配器模板](table-adapter-template.md)）。

```vue
<template>
  <Grid />
</template>

<script setup lang="ts">
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      { field: 'name', title: 'Name' },
      {
        field: 'avatar',
        title: 'Avatar',
        cellRender: { name: 'CellImage' },
      },
      {
        field: 'link',
        title: 'Link',
        cellRender: { name: 'CellLink', props: { text: 'View Details' } },
      },
    ],
    data: [
      { name: 'Zhang San', avatar: 'https://example.com/avatar1.jpg', link: '#' },
      { name: 'Li Si', avatar: 'https://example.com/avatar2.jpg', link: '#' },
    ],
  },
});
</script>
```

## 11. 自定义工具栏

```vue
<template>
  <Grid>
    <template #toolbar-actions>
      <ElButton type="primary" @click="handleAdd">Add</ElButton>
      <ElButton @click="handleExport">Export</ElButton>
    </template>

    <template #toolbar-tools>
      <ElButton @click="handleRefresh">Refresh</ElButton>
    </template>
  </Grid>
</template>

<script setup lang="ts">
import { ElButton } from 'element-plus';
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      { field: 'name', title: 'Name' },
      { field: 'age', title: 'Age' },
    ],
    data: [],
  },
});

const handleAdd = () => {
  console.log('Add');
};

const handleExport = () => {
  console.log('Export');
};

const handleRefresh = () => {
  gridApi.reload();
};
</script>
```

## 12. 使用 GridApi 方法

```vue
<template>
  <div>
    <ElSpace class="mb-4">
      <ElButton @click="handleReload">Reload Table</ElButton>
      <ElButton @click="handleQuery">Query Table</ElButton>
      <ElButton @click="handleToggleSearch">Toggle Search Form</ElButton>
      <ElButton @click="handleSetLoading">Set Loading</ElButton>
    </ElSpace>
    <Grid />
  </div>
</template>

<script setup lang="ts">
import { ElButton, ElSpace } from 'element-plus';
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  showSearchForm: true,
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'name',
        label: 'Name',
      },
    ],
  },
  gridOptions: {
    columns: [
      { field: 'name', title: 'Name' },
      { field: 'age', title: 'Age' },
    ],
    proxyConfig: {
      ajax: {
        query: async ({ page }) => {
          return await fetchTableData({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
  },
});

// 重新加载表格（会重置分页）
const handleReload = () => {
  gridApi.reload();
};

// 查询表格（保持当前分页）
const handleQuery = () => {
  gridApi.query();
};

// 切换搜索表单显示/隐藏
const handleToggleSearch = () => {
  gridApi.toggleSearchForm();
};

// 设置加载状态
const handleSetLoading = () => {
  gridApi.setLoading(true);
  setTimeout(() => {
    gridApi.setLoading(false);
  }, 2000);
};
</script>
```

## 13. 虚拟滚动

```vue
<template>
  <Grid />
</template>

<script setup lang="ts">
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      { field: 'name', title: 'Name' },
      { field: 'age', title: 'Age' },
      { field: 'email', title: 'Email' },
    ],
    height: 480,
    virtualYConfig: {
      enabled: true,
      gt: 100, // 数据超过 100 行时启用虚拟滚动
    },
    data: [], // 大量数据
  },
});
</script>
```
