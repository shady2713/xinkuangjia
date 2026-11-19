<script lang="ts" setup>
/** 部门管理页面 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { OpenApiSchemas } from '#/api/generated/api-types';
import type { SystemDeptApi } from '#/api/system/dept';

import { ref } from 'vue';

import { Page, useVbenModal } from '@vben/common-ui';
import { isEmpty, logError } from '@vben/utils';

import { ElMessage } from 'element-plus';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteDept, deleteDeptList, getDeptList } from '#/api/system/dept';
import { getSimpleUserList } from '#/api/system/user';
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
  clearCheckedIds,
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
  checkedIds.value = records.map((row) => row.id!);
}

const userList = ref<OpenApiSchemas.UserSimpleRespVO[]>([]);

/**
 * 提供当前响应式的精简用户列表供表格列格式化使用。
 *
 * @returns 当前已加载的精简用户列表
 */
function getCurrentUsers(): OpenApiSchemas.UserSimpleRespVO[] {
  return userList.value;
}

/** 加载精简用户列表用于负责人列回显，失败时仅记日志以免阻断部门列表查询。 */
async function loadUserList() {
  try {
    userList.value = await getSimpleUserList();
  } catch (error) {
    logError('system:dept:load-users', error);
  }
}

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: useGridColumns(getCurrentUsers),
    height: 'auto',
    pagerConfig: {
      enabled: false,
    },
    proxyConfig: {
      ajax: {
        /** 并行拉取部门树和负责人映射用户清单，优先返回部门列表数据。 */
        query: async () => {
          const [depts] = await Promise.all([getDeptList(), loadUserList()]);
          return depts;
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
    proxyQuery: clearCheckedIds,
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
