# CRUD 页面与表单组合模板

`[Module]`、`[module]` 与 `[entity]` 为待替换业务标识，禁止直接照搬未替换的占位符。生成新模块 CRUD 页面时，**优先使用 `python -B -X utf8 scripts/scaffold/new_web_crud.py <module> <entity> --title <中文名> --apply`** 一键产出与脚手架、门禁完全一致的文件，再按真实字段调整；手工编写时对照本模板与 `apps/web-ele/src/views/system/post/` 实现。所有 `<script>` 与 `.ts` 模块顶层均须包含完整中文职责注释以通过 `weetion/comments` 门禁。

## index.vue - 主页面

```vue
<script lang="ts" setup>
/**
 * [Title]管理列表页，提供分页查询、弹窗新增编辑与单条/批量删除。
 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { [Module][Entity]Api } from '#/api/[module]/[entity]';

import { Page, useVbenModal } from '@vben/common-ui';
import { buildSortingField } from '@vben/request';
import { isEmpty } from '@vben/utils';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  delete[Entity],
  delete[Entity]List,
  get[Entity]Page,
} from '#/api/[module]/[entity]';
import { useCrudActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';

import { useGridColumns, useGridFormSchema } from './data';
import Form from './modules/form.vue';

const [FormModal, formModalApi] = useVbenModal({
  connectedComponent: Form,
  destroyOnClose: true,
});

/** 清空勾选后重新加载当前分页列表。 */
function handleRefresh() {
  clearCheckedIds();
  gridApi.query();
}

const {
  checkedIds,
  clearCheckedIds,
  getGridEvents,
  handleCreate,
  handleDelete,
  handleDeleteBatch,
  handleEdit,
} = useCrudActions<[Module][Entity]Api.[Entity]>({
  batchDeleteApi: delete[Entity]List,
  deleteApi: delete[Entity],
  getDeleteName: (row) => row.name || '',
  modalApi: formModalApi,
  refresh: handleRefresh,
});

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: {
    schema: useGridFormSchema(),
    submitOnChange: true,
  },
  gridOptions: {
    columns: useGridColumns(),
    height: 'auto',
    keepSource: true,
    proxyConfig: {
      ajax: {
        /** 按当前页、筛选条件与排序参数查询分页列表。 */
        query: async ({ page, sorts }, formValues) => {
          return await get[Entity]Page({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
            ...buildSortingField(sorts),
          });
        },
      },
    },
    rowConfig: {
      keyField: 'id',
      isHover: true,
    },
    toolbarConfig: {
      refresh: true,
      zoom: true,
      search: true,
    },
  } as VxeTableGridOptions<[Module][Entity]Api.[Entity]>,
  gridEvents: getGridEvents(),
});
</script>

<template>
  <Page auto-content-height>
    <FormModal @success="handleRefresh" />
    <Grid>
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: $t('ui.actionTitle.create'),
              type: 'primary',
              icon: ACTION_ICON.ADD,
              auth: ['[module]:[entity]:create'],
              onClick: handleCreate,
            },
            {
              label: $t('ui.actionTitle.deleteBatch'),
              type: 'danger',
              icon: ACTION_ICON.DELETE,
              auth: ['[module]:[entity]:delete'],
              disabled: isEmpty(checkedIds),
              onClick: handleDeleteBatch,
            },
          ]"
        />
      </template>
      <template #actions="{ row }">
        <TableAction
          :actions="[
            {
              label: $t('common.edit'),
              type: 'primary',
              link: true,
              icon: ACTION_ICON.EDIT,
              auth: ['[module]:[entity]:update'],
              onClick: handleEdit.bind(null, row),
            },
            {
              label: $t('common.delete'),
              type: 'danger',
              link: true,
              icon: ACTION_ICON.DELETE,
              auth: ['[module]:[entity]:delete'],
              popConfirm: {
                title: $t('ui.actionMessage.deleteConfirm', [row.name]),
                confirm: handleDelete.bind(null, row),
              },
            },
          ]"
        />
      </template>
    </Grid>
  </Page>
</template>
```

## modules/form.vue - 表单弹窗组件

```vue
<script lang="ts" setup>
/**
 * [Title]新增与编辑弹窗组件，支持 64 位雪花主键。
 */
import type { [Module][Entity]Api } from '#/api/[module]/[entity]';

import { computed, nextTick, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { ElMessage } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { create[Entity], get[Entity], update[Entity] } from '#/api/[module]/[entity]';
import { $t } from '#/locales';

import { useFormSchema } from '../data';

/** 保存成功后通知主页面重新查询。 */
const emit = defineEmits<{ success: [] }>();
const formData = ref<[Module][Entity]Api.[Entity]>();
const id = ref<number | string>();

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
    labelWidth: 80,
  },
  layout: 'horizontal',
  schema: useFormSchema(),
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  /** 校验后提交新增或带主键的更新请求，任意异常均保证释放弹窗锁。 */
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    try {
      modalApi.lock();
      const values = await formApi.getValues<[Module][Entity]Api.[Entity]>();
      if (id.value == null) {
        await create[Entity](values);
      } else {
        await update[Entity]({ ...values, id: id.value });
      }
      await modalApi.close();
      emit('success');
      ElMessage.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  /** 打开弹窗时按主键回填最新详情；关闭时清空缓存状态。 */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      id.value = undefined;
      return;
    }
    const data = modalApi.getData<[Module][Entity]Api.[Entity]>();
    id.value = data?.id;
    await formApi.resetForm();
    if (data?.id == null) {
      formData.value = undefined;
      return;
    }
    try {
      modalApi.lock();
      formData.value = await get[Entity](data.id);
      await nextTick();
      await formApi.setValues(formData.value);
    } finally {
      modalApi.unlock();
    }
  },
});

/** 根据是否存在有效主键区分新增与编辑标题。 */
const getModalTitle = computed(() => {
  return formData.value?.id != null
    ? $t('ui.actionTitle.edit')
    : $t('ui.actionTitle.create');
});
</script>

<template>
  <Modal class="w-[600px]" :title="getModalTitle">
    <Form class="mx-4" />
  </Modal>
</template>
```

## data.ts - 数据配置

```typescript
/**
 * [Title]管理列表与表单 Schema 配置。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { [Module][Entity]Api } from '#/api/[module]/[entity]';

import { $t } from '#/locales';

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

/** 定义列表字段、多选列与 `#actions` 操作插槽。 */
export function useGridColumns(): VxeTableGridOptions<[Module][Entity]Api.[Entity]>['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'name',
      title: '名称',
      minWidth: 160,
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
      formatter: 'formatDateTime',
      width: 180,
    },
    {
      field: 'remark',
      title: '备注',
      minWidth: 120,
    },
    {
      title: '操作',
      fixed: 'right',
      width: 140,
      align: 'center',
      slots: { default: 'actions' },
    },
  ];
}
```
