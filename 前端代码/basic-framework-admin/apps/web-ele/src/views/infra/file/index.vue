<script lang="ts" setup>
/** 文件管理页面 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { InfraFileApi } from '#/api/infra/file';

import { Page, useVbenModal } from '@vben/common-ui';
import { isEmpty, openWindow } from '@vben/utils';

import { useClipboard } from '@vueuse/core';
import { ElButton, ElImage } from 'element-plus';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteFile, getFilePage } from '#/api/infra/file';
import { useCrudActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';
import { showErrorMessage, showSuccessMessage } from '#/utils/feedback';

import { deleteFileBatchAndRefreshOnFailure } from './batch-delete';
import { useGridColumns, useGridFormSchema } from './data';
import Form from './modules/form.vue';

const [FormModal, formModalApi] = useVbenModal({
  connectedComponent: Form,
  destroyOnClose: true,
});

/** 刷新表格 */
async function handleRefresh() {
  clearCheckedIds();
  await gridApi.query();
}

const {
  checkedIds,
  clearCheckedIds,
  getGridEvents,
  handleCreate: handleUpload,
  handleDelete,
  handleDeleteBatch,
} = useCrudActions<InfraFileApi.File>({
  /** 批删后可能仅部分完成，失败也必须重新查询服务端剩余记录。 */
  batchDeleteApi: (ids) =>
    deleteFileBatchAndRefreshOnFailure(ids, handleRefresh),
  deleteApi: deleteFile,
  /**
   * 删除提示里展示的名称：文件名缺失时退回文件路径，两者都为空才返回空串，
   * 由增删改组合式函数改用不带名称的通用提示文案。
   */
  getDeleteName: (row) => row.name || row.path || '',
  modalApi: formModalApi,
  refresh: handleRefresh,
});

/** 复制链接到剪贴板 */
const { copy } = useClipboard({ legacy: true });
/**
 * 复制当前行的文件访问链接并给出结果提示。
 * URL 为空说明该文件记录缺少可访问地址，直接提示而不发起复制；剪贴板写入失败同样以提示结束。
 * @param row 当前操作的文件行，提供需要复制的文件 URL。
 */
async function handleCopyUrl(row: InfraFileApi.File) {
  if (!row.url) {
    showErrorMessage('文件 URL 为空');
    return;
  }

  try {
    await copy(row.url);
    showSuccessMessage('复制成功');
  } catch {
    showErrorMessage('复制失败');
  }
}
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
        /**
         * 按当前分页与搜索条件请求文件列表。
         * page 提供页码与每页条数，formValues 是搜索表单的值，按后端分页字段名一并透传。
         */
        query: async ({ page }, formValues) => {
          return await getFilePage({
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
  } as VxeTableGridOptions<InfraFileApi.File>,
  gridEvents: getGridEvents(),
});
</script>

<template>
  <Page auto-content-height>
    <FormModal @success="handleRefresh" />
    <Grid table-title="文件列表">
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: '上传文件',
              type: 'primary',
              icon: ACTION_ICON.UPLOAD,
              onClick: handleUpload,
            },
            {
              label: $t('ui.actionTitle.deleteBatch'),
              type: 'danger',
              icon: ACTION_ICON.DELETE,
              disabled: isEmpty(checkedIds),
              auth: ['infra:file:delete'],
              onClick: handleDeleteBatch,
            },
          ]"
        />
      </template>
      <template #file-content="{ row }">
        <ElImage v-if="row.type && row.type.includes('image')" :src="row.url" />
        <ElButton type="primary" link @click="() => openWindow(row.url!)">
          {{ row.type && row.type.includes('pdf') ? '预览' : '下载' }}
        </ElButton>
      </template>
      <template #actions="{ row }">
        <TableAction
          :actions="[
            {
              label: '复制链接',
              type: 'primary',
              link: true,
              icon: ACTION_ICON.COPY,
              onClick: handleCopyUrl.bind(null, row),
            },
            {
              label: $t('common.delete'),
              type: 'danger',
              link: true,
              icon: ACTION_ICON.DELETE,
              auth: ['infra:file:delete'],
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
