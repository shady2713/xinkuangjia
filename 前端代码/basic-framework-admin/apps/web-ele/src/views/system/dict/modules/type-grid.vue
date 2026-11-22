<script lang="ts" setup>
/** 字典类型表格组件，负责字典类型分页查询、维护、选中联动及导出。 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemDictTypeApi } from '#/api/system/dict/type';

import { useVbenModal } from '@vben/common-ui';
import { buildSortingField } from '@vben/request';
import { isEmpty } from '@vben/utils';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteDictType,
  deleteDictTypeList,
  getDictTypePage,
} from '#/api/system/dict/type';
import { useCrudActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';

import { useTypeGridColumns, useTypeGridFormSchema } from '../data';
import TypeForm from './type-form.vue';

const emit = defineEmits(['select']);

const [TypeFormModal, typeFormModalApi] = useVbenModal({
  connectedComponent: TypeForm,
  destroyOnClose: true,
});

/** 刷新表格 */
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
} = useCrudActions<SystemDictTypeApi.DictType>({
  batchDeleteApi: deleteDictTypeList,
  deleteApi: deleteDictType,
  getDeleteName: (row) => row.name || '',
  modalApi: typeFormModalApi,
  refresh: handleRefresh,
});
const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: {
    schema: useTypeGridFormSchema(),
  },
  gridOptions: {
    columns: useTypeGridColumns(),
    height: 'auto',
    keepSource: true,
    proxyConfig: {
      ajax: {
        /** 按当前页、筛选条件和表格排序查询列表。 */
        query: async ({ page, sorts }, formValues) => {
          return await getDictTypePage({
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
      isCurrent: true,
      isHover: true,
    },
    toolbarConfig: {
      refresh: true,
      search: true,
    },
  } as VxeTableGridOptions<SystemDictTypeApi.DictType>,
  gridEvents: getGridEvents({
    cellClick: ({ row }: { row: SystemDictTypeApi.DictType }) => {
      emit('select', row.type);
    },
  }),
});
</script>

<template>
  <div class="h-full">
    <TypeFormModal @success="handleRefresh" />
    <Grid table-title="字典类型列表">
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: $t('ui.actionTitle.create', ['字典类型']),
              type: 'primary',
              icon: ACTION_ICON.ADD,
              auth: ['system:dict:create'],
              onClick: handleCreate,
            },
            {
              label: $t('ui.actionTitle.deleteBatch'),
              type: 'danger',
              icon: ACTION_ICON.DELETE,
              disabled: isEmpty(checkedIds),
              auth: ['system:dict:delete'],
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
              auth: ['system:dict:update'],
              onClick: handleEdit.bind(null, row),
            },
            {
              label: $t('common.delete'),
              type: 'danger',
              link: true,
              icon: ACTION_ICON.DELETE,
              auth: ['system:dict:delete'],
              popConfirm: {
                title: $t('ui.actionMessage.deleteConfirm', [row.name]),
                confirm: handleDelete.bind(null, row),
              },
            },
          ]"
        />
      </template>
    </Grid>
  </div>
</template>
