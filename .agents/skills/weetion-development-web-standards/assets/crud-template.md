# CRUD 页面与表单组合模板

`[Module]`、`[module]` 是待替换的业务标识，不是可直接编译的名称。以下展示页面、表单和数据配置；生成完整模块时还须按 [CRUD 流程](../references/crud-workflow.md)补齐实际 API 类型、请求封装及后端菜单授权。默认管理应用为 Element Plus，优先对照 `apps/web-ele/src/views/system/post` 的现有组合；不要向应用添加 Ant Design 依赖。示例复用已有系统翻译键，新增业务文案是否国际化按用户要求决定。

## index.vue - 主页面

```vue
<script lang="ts" setup>
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { OperationEvent } from './data';
import type { [Module]Api } from '#/api/[module]';

import { Page, useVbenDrawer } from '@vben/common-ui';
import { Plus } from '@vben/icons';
import { ElButton, ElMessage } from 'element-plus';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { delete[Module], get[Module]List } from '#/api/[module]';
import { $t } from '#/locales';

import { useColumns, useGridFormSchema } from './data';
import Form from './modules/form.vue';

const [FormDrawer, formDrawerApi] = useVbenDrawer({
  connectedComponent: Form,
  destroyOnClose: true,
});

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: {
    schema: useGridFormSchema(),
    submitOnChange: true,
  },
  gridOptions: {
    columns: useColumns(onActionClick),
    height: 'auto',
    proxyConfig: {
      ajax: {
        query: async ({ page }, formValues) => {
          return await get[Module]List({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
          });
        },
      },
    },
    toolbarConfig: {
      refresh: true,
      zoom: true,
      search: true,
    },
  } as VxeTableGridOptions,
});

/** 按操作码打开编辑表单或进入删除确认。 */
function onActionClick(e: OperationEvent) {
  switch (e.code) {
    case 'delete': {
      onDelete(e.row);
      break;
    }
    case 'edit': {
      onEdit(e.row);
      break;
    }
  }
}

/** 将目标记录传给编辑抽屉，不修改列表行本身。 */
function onEdit(row: [Module]Api.[Module]) {
  formDrawerApi.setData(row).open();
}

/** CellOperation 确认后删除有效编号对应的记录；请求错误由请求客户端提示。 */
async function onDelete(row: [Module]Api.[Module]) {
  if (row.id == null) return;
  await delete[Module](row.id);
  ElMessage.success($t('ui.actionMessage.deleteSuccess', [row.name]));
  await onRefresh();
}

/** 重新读取当前筛选下的分页数据。 */
function onRefresh() {
  return gridApi.query();
}

/** 使用空记录打开新增表单，避免继承上一条编辑记录。 */
function onCreate() {
  formDrawerApi.setData({}).open();
}
</script>

<template>
  <Page auto-content-height>
    <FormDrawer @success="onRefresh" />
    <Grid>
      <template #toolbar-tools>
        <ElButton type="primary" @click="onCreate">
          <Plus class="size-5" />
          {{ $t('ui.actionTitle.create') }}
        </ElButton>
      </template>
    </Grid>
  </Page>
</template>
```

## modules/form.vue - 表单组件

```vue
<script lang="ts" setup>
import type { [Module]Api } from '#/api/[module]';

import { computed, nextTick, ref } from 'vue';
import { useVbenDrawer } from '@vben/common-ui';

import { useVbenForm } from '#/adapter/form';
import { create[Module], update[Module] } from '#/api/[module]';
import { $t } from '#/locales';

import { useFormSchema } from '../data';

/** 保存成功后通知主页面重新查询。 */
const emits = defineEmits<{ success: [] }>();
const formData = ref<[Module]Api.[Module]>();

const [Form, formApi] = useVbenForm({
  schema: useFormSchema(),
  showDefaultActions: false,
});

const id = ref<number>();
const [Drawer, drawerApi] = useVbenDrawer({
  /** 校验后提交新增或带编号的更新，成功关闭；失败始终释放抽屉锁。 */
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) return;
    const values = await formApi.getValues<[Module]Api.[Module]>();
    drawerApi.lock();
    try {
      // 更新接口接收包含 id 的完整对象；编号为空时走新增。
      if (id.value == null) {
        await create[Module](values);
      } else {
        await update[Module]({ ...values, id: id.value });
      }
      emits('success');
      await drawerApi.close();
    } finally {
      drawerApi.unlock();
    }
  },
  /** 打开时清空旧值并加载当前记录，关闭时释放编辑态。 */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      id.value = undefined;
      return;
    }
    const data = drawerApi.getData<[Module]Api.[Module]>();
    formData.value = data?.id == null ? undefined : data;
    id.value = data?.id;
    await formApi.resetForm();
    await nextTick();
    if (formData.value) await formApi.setValues(formData.value);
  },
});

/** 由当前有效编辑编号区分新增与编辑标题。 */
const getDrawerTitle = computed(() => {
  return formData.value?.id
    ? $t('ui.actionTitle.edit')
    : $t('ui.actionTitle.create');
});
</script>

<template>
  <Drawer :title="getDrawerTitle">
    <Form />
  </Drawer>
</template>
```

## data.ts - 数据配置

```typescript
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { [Module]Api } from '#/api/[module]';

import { $t } from '#/locales';

/** 操作列发送的业务记录及操作码，由本模块定义而非表格适配器导出。 */
export interface OperationEvent {
  code: string;
  row: [Module]Api.[Module];
}

/** 返回实体名称、状态和备注的编辑校验配置。 */
export function useFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'name',
      label: '名称',
      rules: 'required',
    },
    {
      component: 'RadioGroup',
      componentProps: {
        isButton: true,
        options: [
          { label: $t('common.enabled'), value: 0 },
          { label: $t('common.disabled'), value: 1 },
        ],
      },
      defaultValue: 0,
      fieldName: 'status',
      label: '状态',
    },
    {
      component: 'Textarea',
      fieldName: 'remark',
      label: '备注',
    },
  ];
}

/** 返回名称和状态筛选项，空条件由后端按可选筛选处理。 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'name',
      label: '名称',
    },
    {
      component: 'Select',
      componentProps: {
        clearable: true,
        options: [
          { label: $t('common.enabled'), value: 0 },
          { label: $t('common.disabled'), value: 1 },
        ],
      },
      fieldName: 'status',
      label: '状态',
    },
  ];
}

/** 定义列表字段及操作回调；权限标识须按当前业务补齐。 */
export function useColumns(
  onActionClick: (event: OperationEvent) => void,
): VxeTableGridOptions['columns'] {
  return [
    {
      field: 'name',
      title: '名称',
      width: 200,
    },
    {
      field: 'status',
      title: '状态',
      cellRender: { name: 'CellTag' },
      width: 100,
    },
    {
      field: 'createTime',
      title: '创建时间',
      width: 200,
    },
    {
      field: 'remark',
      title: '备注',
      minWidth: 100,
    },
    {
      field: 'operation',
      title: '操作',
      fixed: 'right',
      width: 130,
      align: 'center',
      cellRender: {
        name: 'CellOperation',
        // 操作可见性须按真实业务权限配置，服务端仍需校验权限。
        options: ['edit', 'delete'],
        attrs: {
          onClick: onActionClick,
        },
      },
    },
  ];
}
```
