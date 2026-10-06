<script lang="ts" setup>
/** 用户管理页面 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemDeptApi } from '#/api/system/dept';
import type { SystemUserApi } from '#/api/system/user';

import { ref } from 'vue';

import { confirm, Page, useVbenModal } from '@vben/common-ui';
import { DICT_TYPE } from '@vben/constants';
import { getDictLabel } from '@vben/hooks';
import { downloadFileFromBlobPart, isEmpty } from '@vben/utils';

import { ElCard, ElMessage } from 'element-plus';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteUser,
  deleteUserList,
  exportUser,
  getUserPage,
  updateUserStatus,
} from '#/api/system/user';
import { useCrudActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';

import { useGridColumns, useGridFormSchema } from './data';
import AssignRoleForm from './modules/assign-role-form.vue';
import DeptTree from './modules/dept-tree.vue';
import Form from './modules/form.vue';
import ImportForm from './modules/import-form.vue';
import ResetPasswordForm from './modules/reset-password-form.vue';

const [FormModal, formModalApi] = useVbenModal({
  connectedComponent: Form,
  destroyOnClose: true,
});

const [ResetPasswordModal, resetPasswordModalApi] = useVbenModal({
  connectedComponent: ResetPasswordForm,
  destroyOnClose: true,
});

const [AssignRoleModal, assignRoleModalApi] = useVbenModal({
  connectedComponent: AssignRoleForm,
  destroyOnClose: true,
});

const [ImportModal, importModalApi] = useVbenModal({
  connectedComponent: ImportForm,
  destroyOnClose: true,
});

/** 刷新表格 */
function handleRefresh() {
  clearCheckedIds();
  gridApi.query();
}

/** 导出表格 */
async function handleExport() {
  const data = await exportUser(await gridApi.formApi.getValues());
  downloadFileFromBlobPart({ fileName: '用户.xls', source: data });
}

/** 选择部门 */
const searchDeptId = ref<number | undefined>(undefined);
/** 接收左侧部门树的选择结果：记下部门编号并立即刷新用户列表。 */
async function handleDeptSelect(dept: SystemDeptApi.Dept) {
  searchDeptId.value = dept.id;
  handleRefresh();
}

/** 导入用户 */
function handleImport() {
  importModalApi.open();
}

const {
  checkedIds,
  clearCheckedIds,
  getGridEvents,
  handleCreate,
  handleDelete,
  handleDeleteBatch,
  handleEdit,
} = useCrudActions<SystemUserApi.User>({
  batchDeleteApi: deleteUserList,
  deleteApi: deleteUser,
  /** 二次确认与成功提示中展示的用户名；取不到用户名时退化为不带名称的通用文案。 */
  getDeleteName: (row) => row.username || '',
  modalApi: formModalApi,
  refresh: handleRefresh,
});

/** 重置密码 */
function handleResetPassword(row: SystemUserApi.User) {
  resetPasswordModalApi.setData(row).open();
}

/** 分配角色 */
function handleAssignRole(row: SystemUserApi.User) {
  assignRoleModalApi.setData(row).open();
}

/** 更新用户状态 */
async function handleStatusChange(
  newStatus: number,
  row: SystemUserApi.User,
): Promise<boolean | undefined> {
  return new Promise(
    /**
     * 交由二次确认组件承载用户决策；确认后执行状态更新并按结果 resolve。
     * @param resolve 状态更新成功时 resolve true，缺少主键时 resolve false。
     * @param reject 用户取消或写库失败时调用，向调用方透出失败原因。
     */
    (resolve, reject) => {
      confirm({
        content: `你要将${row.username}的状态切换为【${getDictLabel(DICT_TYPE.COMMON_STATUS, newStatus)}】吗？`,
      }).then(
        /**
         * 用户确认后写库：缺少主键直接判失败，写库失败给出提示并拒绝原始错误。
         * @returns 无返回值；结果通过 resolve 或 reject 传给调用方。
         */
        async () => {
          // 状态变更会写库，行缺少 id 时无法定位目标记录，直接失败而不是用 undefined 发请求
          const userId = row.id;
          if (userId === undefined) {
            ElMessage.error($t('ui.actionMessage.operationFailed'));
            resolve(false);
            return;
          }
          try {
            // 更新用户状态
            await updateUserStatus(userId, newStatus);
          } catch (error) {
            // 写库失败必须与「用户取消」分开处理：取消是用户的正常决策，既不写库也不提示；
            // 失败要让管理员看到提示并拿到原始错误，否则行内开关只会静默回滚。
            ElMessage.error($t('ui.actionMessage.operationFailed'));
            reject(error);
            return;
          }
          // 提示并返回成功
          ElMessage.success($t('ui.actionMessage.operationSuccess'));
          resolve(true);
        },
        /**
         * 用户取消确认时以「取消操作」拒绝，让调用方据此回滚行内状态。
         * 该分支只处理二次确认被取消，不再兜住写库异常。
         */
        () => {
          reject(new Error('取消操作'));
        },
      );
    },
  );
}

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: {
    schema: useGridFormSchema(),
  },
  gridOptions: {
    columns: useGridColumns(handleStatusChange),
    height: 'auto',
    keepSource: true,
    proxyConfig: {
      ajax: {
        /** 分页查询用户列表：固定带上左侧部门树选中的部门编号，页码与检索条件分别取自分页与搜索表单。 */
        query: async ({ page }, formValues) => {
          return await getUserPage({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
            deptId: searchDeptId.value,
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
  } as VxeTableGridOptions<SystemUserApi.User>,
  gridEvents: getGridEvents(),
});
</script>

<template>
  <Page auto-content-height>
    <FormModal @success="handleRefresh" />
    <ResetPasswordModal @success="handleRefresh" />
    <AssignRoleModal @success="handleRefresh" />
    <ImportModal @success="handleRefresh" />

    <div class="flex h-full w-full">
      <!-- 左侧部门树 -->
      <ElCard class="mr-4 h-full w-1/6">
        <DeptTree @select="handleDeptSelect" />
      </ElCard>
      <!-- 右侧用户列表 -->
      <div class="w-5/6">
        <Grid table-title="用户列表">
          <template #toolbar-tools>
            <TableAction
              :actions="[
                {
                  label: $t('ui.actionTitle.create', ['用户']),
                  type: 'primary',
                  icon: ACTION_ICON.ADD,
                  auth: ['system:user:create'],
                  onClick: handleCreate,
                },
                {
                  label: $t('ui.actionTitle.export'),
                  type: 'primary',
                  icon: ACTION_ICON.DOWNLOAD,
                  auth: ['system:user:export'],
                  onClick: handleExport,
                },
                {
                  label: $t('ui.actionTitle.import', ['用户']),
                  type: 'primary',
                  icon: ACTION_ICON.UPLOAD,
                  auth: ['system:user:import'],
                  onClick: handleImport,
                },
                {
                  label: $t('ui.actionTitle.deleteBatch'),
                  type: 'danger',
                  icon: ACTION_ICON.DELETE,
                  disabled: isEmpty(checkedIds),
                  auth: ['system:user:delete'],
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
                  auth: ['system:user:update'],
                  onClick: handleEdit.bind(null, row),
                },
                {
                  label: $t('common.delete'),
                  type: 'danger',
                  link: true,
                  icon: ACTION_ICON.DELETE,
                  auth: ['system:user:delete'],
                  popConfirm: {
                    title: $t('ui.actionMessage.deleteConfirm', [row.username]),
                    confirm: handleDelete.bind(null, row),
                  },
                },
              ]"
              :drop-down-actions="[
                {
                  label: '分配角色',
                  type: 'primary',
                  link: true,
                  auth: ['system:permission:assign-user-role'],
                  onClick: handleAssignRole.bind(null, row),
                },
                {
                  label: '重置密码',
                  type: 'primary',
                  link: true,
                  auth: ['system:user:update-password'],
                  onClick: handleResetPassword.bind(null, row),
                },
              ]"
            />
          </template>
        </Grid>
      </div>
    </div>
  </Page>
</template>
