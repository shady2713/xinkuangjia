<script lang="ts" setup>
/** [entity-title]管理页面 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { [Entity] } from '#/api/[module]/[entity]';

import { Page, useVbenModal } from '@vben/common-ui';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import { delete[Entity], get[Entity]Page } from '#/api/[module]/[entity]';
import { useCrudItemActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';

import { useGridColumns, useGridFormSchema } from './data';
import Form from './modules/form.vue';

const [FormModal, formModalApi] = useVbenModal({
  connectedComponent: Form,
  destroyOnClose: true,
});

/** 刷新表格 */
function handleRefresh() {
  gridApi.query();
}

const { handleCreate, handleDelete, handleEdit } = useCrudItemActions<[Entity]>({
  /** 没有编号的行无法定位后端记录：先拦截，不能让删除请求指向空目标。 */
  beforeDelete: (row) => row.id !== undefined,
  deleteApi: delete[Entity],
  /** 删除确认文案使用记录名称；名称为空时回退到通用文案。 */
  getDeleteName: (row) => row.name || '',
  /** 行键兜底值只用于满足类型契约；上面的 beforeDelete 已保证不会用它发起请求。 */
  getRowKey: (row) => row.id ?? -1,
  modalApi: formModalApi,
  refresh: handleRefresh,
});

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: {
    schema: useGridFormSchema(),
  },
  gridOptions: {
    columns: useGridColumns(),
    height: 'auto',
    keepSource: true,
    proxyConfig: {
      ajax: {
        query: async ({ page }, formValues) => {
          return await get[Entity]Page({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
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
      search: true,
    },
  } as VxeTableGridOptions<[Entity]>,
});
</script>

<template>
  <Page auto-content-height>
    <FormModal @success="handleRefresh" />
    <Grid table-title="[entity-title]列表">
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: $t('ui.actionTitle.create', ['[entity-name]']),
              type: 'primary',
              icon: ACTION_ICON.ADD,
              auth: ['[permission]:create'],
              onClick: handleCreate,
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
              auth: ['[permission]:update'],
              onClick: handleEdit.bind(null, row),
            },
            {
              label: $t('common.delete'),
              type: 'danger',
              link: true,
              icon: ACTION_ICON.DELETE,
              auth: ['[permission]:delete'],
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
