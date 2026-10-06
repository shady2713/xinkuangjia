<script lang="ts" setup>
/**
 * 字典数据表格：左侧类型栏选中后按 dictType 重查，支持增删改与导出。
 * 当前的字典类型由父页面透传，类型自身的维护在 type-grid.vue。
 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemDictDataApi } from '#/api/system/dict/data';

import { watch } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { downloadFileFromBlobPart, isEmpty } from '@vben/utils';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteDictData,
  deleteDictDataList,
  exportDictData,
  getDictDataPage,
} from '#/api/system/dict/data';
import { useCrudActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';

import { useDataGridColumns, useDataGridFormSchema } from '../data';
import DataForm from './data-form.vue';

const props = defineProps({
  dictType: {
    type: String,
    default: undefined,
  },
});

const [DataFormModal, dataFormModalApi] = useVbenModal({
  connectedComponent: DataForm,
  destroyOnClose: true,
});

/** 刷新表格 */
function handleRefresh() {
  clearCheckedIds();
  gridApi.query();
}

/** 导出表格 */
async function handleExport() {
  const data = await exportDictData(await gridApi.formApi.getValues());
  downloadFileFromBlobPart({ fileName: '字典数据.xls', source: data });
}

const {
  checkedIds,
  clearCheckedIds,
  getGridEvents,
  handleCreate,
  handleDelete,
  handleDeleteBatch,
  handleEdit,
} = useCrudActions<SystemDictDataApi.DictData>({
  batchDeleteApi: deleteDictDataList,
  /**
   * 新增时的初始值：字典类型由父组件通过 props 指定，其余字段留给表单填写。
   * @returns 带字典类型的空字典项。
   */
  createData: () =>
    ({ dictType: props.dictType }) as SystemDictDataApi.DictData,
  deleteApi: deleteDictData,
  /**
   * 删除确认框里展示的名称，优先用字典标签，标签为空时退回空串而不是显示 undefined。
   * @param row 当前行的字典项数据。
   * @returns 用于二次确认提示的名称。
   */
  getDeleteName: (row) => row.label || '',
  modalApi: dataFormModalApi,
  refresh: handleRefresh,
});
const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: {
    schema: useDataGridFormSchema(),
  },
  gridOptions: {
    columns: useDataGridColumns(),
    height: 'auto',
    keepSource: true,
    proxyConfig: {
      ajax: {
        /** 分页查询字典数据：固定按当前选中的字典类型过滤，页码与检索条件分别取自分页与搜索表单。 */
        query: async ({ page }, formValues) => {
          return await getDictDataPage({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
            dictType: props.dictType,
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
  } as VxeTableGridOptions<SystemDictDataApi.DictData>,
  gridEvents: getGridEvents(),
});

/** 监听 dictType 变化，重新查询 */
watch(
  () => props.dictType,
  () => {
    if (props.dictType) {
      handleRefresh();
    }
  },
);
</script>

<template>
  <div class="flex h-full flex-col">
    <DataFormModal @success="handleRefresh" />

    <Grid table-title="字典数据列表">
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: $t('ui.actionTitle.create', ['字典数据']),
              type: 'primary',
              icon: ACTION_ICON.ADD,
              auth: ['system:dict:create'],
              onClick: handleCreate,
            },
            {
              label: $t('ui.actionTitle.export'),
              type: 'primary',
              icon: ACTION_ICON.DOWNLOAD,
              auth: ['system:dict:export'],
              onClick: handleExport,
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
                title: $t('ui.actionMessage.deleteConfirm', [row.label]),
                confirm: handleDelete.bind(null, row),
              },
            },
          ]"
        />
      </template>
    </Grid>
  </div>
</template>
