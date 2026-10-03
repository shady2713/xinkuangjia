<script lang="ts" setup>
/** 部门管理页面 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemDeptApi } from '#/api/system/dept';

import { ref } from 'vue';

import { Page, useVbenModal } from '@vben/common-ui';
import { isEmpty } from '@vben/utils';

import { ElMessage } from 'element-plus';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteDept, deleteDeptList, getDeptList } from '#/api/system/dept';
import { useCrudActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';

import { useGridColumns } from './data';
import Form from './modules/form.vue';

const [FormModal, formModalApi] = useVbenModal({
  connectedComponent: Form,
  destroyOnClose: true,
});

/** 切换树形展开/收缩状态 */
const isExpanded = ref(true);
function handleExpand() {
  isExpanded.value = !isExpanded.value;
  gridApi.grid.setAllTreeExpand(isExpanded.value);
}

/** 刷新表格 */
function handleRefresh() {
  checkedIds.value = [];
  gridApi.grid?.clearCheckboxRow?.();
  gridApi.query();
}

/** 添加下级部门 */
function handleAppend(row: SystemDeptApi.Dept) {
  formModalApi.setData({ parentId: row.id }).open();
}

function hasChildDept(row: SystemDeptApi.Dept) {
  return (gridApi.grid?.getTreeRowChildren(row)?.length ?? 0) > 0;
}

const {
  checkedIds,
  handleCreate,
  handleDelete,
  handleDeleteBatch,
  handleEdit,
} = useCrudActions<SystemDeptApi.Dept>({
  batchDeleteApi: deleteDeptList,
  beforeDelete: (row) => {
    if (!hasChildDept(row)) {
      return true;
    }
    ElMessage.warning('请先删除下级部门');
    return false;
  },
  deleteApi: deleteDept,
  getDeleteName: (row) => row.name || '',
  modalApi: formModalApi,
  refresh: handleRefresh,
});

/** 直接从表格读取当前选中行，避免事件参数带缓存 */
function handleRowCheckboxChange() {
  const records = (gridApi.grid?.getCheckboxRecords?.() ||
    []) as SystemDeptApi.Dept[];
  // 勾选结果会直接用于批量删除，缺少 id 的行无法定位目标，必须排除而不是带入
  checkedIds.value = records
    .map(
      /**
       * 取出该行的主键。
       * @param row 表格当前勾选的行。
       * @returns 行主键；DTO 未提供时为 undefined。
       */
      (row) => row.id,
    )
    .filter(
      /**
       * 剔除缺少主键的行。
       * @param id 行主键。
       * @returns 主键存在时返回 true。
       */
      (id): id is number => id !== undefined,
    );
}

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: useGridColumns(),
    height: 'auto',
    pagerConfig: {
      enabled: false,
    },
    proxyConfig: {
      ajax: {
        query: async () => {
          return await getDeptList();
        },
      },
    },
    rowConfig: {
      keyField: 'id',
      isHover: true,
    },
    checkboxConfig: {
      checkMethod: ({ row }) => !hasChildDept(row),
      reserve: false,
      checkStrictly: true,
    },
    toolbarConfig: {
      refresh: true,
      search: true,
    },
    treeConfig: {
      parentField: 'parentId',
      rowField: 'id',
      transform: true,
      expandAll: true,
    },
  } as VxeTableGridOptions<SystemDeptApi.Dept>,
  gridEvents: {
    checkboxAll: handleRowCheckboxChange,
    checkboxChange: handleRowCheckboxChange,
  },
});
</script>

<template>
  <Page auto-content-height>
    <FormModal @success="handleRefresh" />
    <Grid table-title="部门列表">
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: $t('ui.actionTitle.create', ['部门']),
              type: 'primary',
              icon: ACTION_ICON.ADD,
              auth: ['system:dept:create'],
              onClick: handleCreate,
            },
            {
              label: isExpanded ? '收缩' : '展开',
              type: 'primary',
              onClick: handleExpand,
            },
            {
              label: $t('ui.actionTitle.deleteBatch'),
              type: 'danger',
              icon: ACTION_ICON.DELETE,
              auth: ['system:dept:delete'],
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
              label: '新增下级',
              type: 'primary',
              link: true,
              icon: ACTION_ICON.ADD,
              auth: ['system:dept:create'],
              onClick: handleAppend.bind(null, row),
            },
            {
              label: $t('common.edit'),
              type: 'primary',
              link: true,
              icon: ACTION_ICON.EDIT,
              auth: ['system:dept:update'],
              onClick: handleEdit.bind(null, row),
            },
            {
              label: $t('common.delete'),
              type: 'danger',
              link: true,
              icon: ACTION_ICON.DELETE,
              auth: ['system:dept:delete'],
              disabled: hasChildDept(row),
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
