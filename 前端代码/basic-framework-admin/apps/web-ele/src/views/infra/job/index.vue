<script lang="ts" setup>
/** 定时任务管理页面 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { InfraJobApi } from '#/api/infra/job';

import { useRouter } from 'vue-router';

import { confirm, Page, useVbenModal } from '@vben/common-ui';
import { InfraJobStatusEnum } from '@vben/constants';
import { downloadFileFromBlobPart, isEmpty } from '@vben/utils';

import { ElLoading, ElMessage } from 'element-plus';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteJob,
  deleteJobList,
  exportJob,
  getJobPage,
  runJob,
  updateJobStatus,
} from '#/api/infra/job';
import { useCrudActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';

import { useGridColumns, useGridFormSchema } from './data';
import Detail from './modules/detail.vue';
import Form from './modules/form.vue';

const { push } = useRouter();

const [FormModal, formModalApi] = useVbenModal({
  connectedComponent: Form,
  destroyOnClose: true,
});

const [DetailModal, detailModalApi] = useVbenModal({
  connectedComponent: Detail,
  destroyOnClose: true,
});

/** 刷新表格 */
function handleRefresh() {
  clearCheckedIds();
  gridApi.query();
}

/** 导出表格 */
async function handleExport() {
  const data = await exportJob(await gridApi.formApi.getValues());
  downloadFileFromBlobPart({ fileName: '定时任务.xls', source: data });
}

/** 查看任务详情 */
function handleDetail(row: InfraJobApi.Job) {
  detailModalApi.setData({ id: row.id }).open();
}

/** 更新任务状态 */
/**
 * 切换定时任务的启用/停用状态。
 * @param row 当前操作的任务行，提供任务主键与名称。
 * @returns 无返回值；失败信息由提示组件给出。
 */
async function handleUpdateStatus(row: InfraJobApi.Job) {
  const status =
    row.status === InfraJobStatusEnum.STOP
      ? InfraJobStatusEnum.NORMAL
      : InfraJobStatusEnum.STOP;
  const statusText = status === InfraJobStatusEnum.NORMAL ? '启用' : '停用';

  // 状态变更会写库，行缺少 id 时无法定位目标任务，直接提示失败而不是用 undefined 发请求
  if (row.id === undefined) {
    ElMessage.error($t('ui.actionMessage.operationFailed'));
    return;
  }

  await confirm(`确定${statusText} ${row.name} 吗？`);
  const loadingInstance = ElLoading.service({
    text: `正在${statusText}中...`,
  });
  try {
    await updateJobStatus(row.id, status);
    ElMessage.success($t('ui.actionMessage.operationSuccess'));
    handleRefresh();
  } finally {
    loadingInstance.close();
  }
}

/** 执行一次任务 */
async function handleTrigger(row: InfraJobApi.Job) {
  // 触发任务会写库并调度执行，行缺少 id 时无法定位目标任务，直接提示失败
  if (row.id === undefined) {
    ElMessage.error($t('ui.actionMessage.operationFailed'));
    return;
  }
  await confirm(`确定执行一次 ${row.name} 吗？`);
  const loadingInstance = ElLoading.service({
    text: '正在执行中...',
  });
  try {
    await runJob(row.id);
    ElMessage.success($t('ui.actionMessage.operationSuccess'));
  } finally {
    loadingInstance.close();
  }
}

/** 跳转到任务日志 */
function handleLog(row?: InfraJobApi.Job) {
  push({
    name: 'InfraJobLog',
    query: row?.id ? { id: row.id } : {},
  });
}

const {
  checkedIds,
  clearCheckedIds,
  getGridEvents,
  handleCreate,
  handleDelete,
  handleDeleteBatch,
  handleEdit,
} = useCrudActions<InfraJobApi.Job>({
  batchDeleteApi: deleteJobList,
  deleteApi: deleteJob,
  getDeleteName: (row) => row.name || '',
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
          return await getJobPage({
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
  } as VxeTableGridOptions<InfraJobApi.Job>,
  gridEvents: getGridEvents(),
});
</script>

<template>
  <Page auto-content-height>
    <FormModal @success="handleRefresh" />
    <DetailModal />
    <Grid table-title="定时任务列表">
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: $t('ui.actionTitle.create', ['任务']),
              type: 'primary',
              icon: ACTION_ICON.ADD,
              auth: ['infra:job:create'],
              onClick: handleCreate,
            },
            {
              label: $t('ui.actionTitle.export'),
              type: 'primary',
              icon: ACTION_ICON.DOWNLOAD,
              auth: ['infra:job:export'],
              onClick: handleExport,
            },
            {
              label: '执行日志',
              type: 'primary',
              icon: 'lucide:history',
              auth: ['infra:job:query'],
              onClick: () => handleLog(undefined),
            },
            {
              label: $t('ui.actionTitle.deleteBatch'),
              type: 'danger',
              icon: ACTION_ICON.DELETE,
              disabled: isEmpty(checkedIds),
              auth: ['infra:job:delete'],
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
              auth: ['infra:job:update'],
              onClick: handleEdit.bind(null, row),
            },
            {
              label: '开启',
              type: 'primary',
              link: true,
              icon: 'lucide:circle-play',
              auth: ['infra:job:update'],
              ifShow: () => row.status === InfraJobStatusEnum.STOP,
              onClick: handleUpdateStatus.bind(null, row),
            },
            {
              label: '暂停',
              type: 'primary',
              link: true,
              icon: 'lucide:circle-pause',
              auth: ['infra:job:update'],
              ifShow: () => row.status === InfraJobStatusEnum.NORMAL,
              onClick: handleUpdateStatus.bind(null, row),
            },
            {
              label: '执行',
              type: 'primary',
              link: true,
              icon: 'lucide:clock-plus',
              auth: ['infra:job:trigger'],
              onClick: handleTrigger.bind(null, row),
            },
          ]"
          :drop-down-actions="[
            {
              label: $t('common.detail'),
              type: 'primary',
              link: true,
              auth: ['infra:job:query'],
              onClick: handleDetail.bind(null, row),
            },
            {
              label: '日志',
              type: 'primary',
              link: true,
              auth: ['infra:job:query'],
              onClick: handleLog.bind(null, row),
            },
            {
              label: $t('common.delete'),
              type: 'danger',
              link: true,
              auth: ['infra:job:delete'],
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
