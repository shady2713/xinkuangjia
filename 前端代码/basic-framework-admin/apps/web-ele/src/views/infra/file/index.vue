<script lang="ts" setup>
/** 文件管理页面 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { InfraFileApi } from '#/api/infra/file';

import { Page, useVbenModal } from '@vben/common-ui';
import { buildSortingField } from '@vben/request';
import { isEmpty, openWindow } from '@vben/utils';

import { useClipboard } from '@vueuse/core';
import { ElButton, ElImage } from 'element-plus';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteFile,
  deleteFileList,
  getFilePage,
  getPrivateFilePresignedUrl,
} from '#/api/infra/file';
import { useCrudActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';
import { showErrorMessage, showSuccessMessage } from '#/utils/feedback';

import { useGridColumns, useGridFormSchema } from './data';
import Form from './modules/form.vue';

const [FormModal, formModalApi] = useVbenModal({
  connectedComponent: Form,
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
  handleCreate: handleUpload,
  handleDelete,
  handleDeleteBatch,
} = useCrudActions<InfraFileApi.File>({
  batchDeleteApi: deleteFileList,
  deleteApi: deleteFile,
  getDeleteName: (row) => row.name || row.path || '',
  modalApi: formModalApi,
  refresh: handleRefresh,
});

/**
 * 解析文件访问地址：公开资源直接返回持久化 URL，私有附件（url 为空）按需申请限时预签名地址。
 *
 * @param row 文件列表行记录
 * @returns 包含目标地址与是否为临时授权链接的解析结果
 */
async function resolveFileAccessUrl(
  row: InfraFileApi.File,
): Promise<{ isPrivate: boolean; url: string }> {
  if (row.url) {
    return { isPrivate: false, url: row.url };
  }
  if (row.id === undefined || row.id === null || row.id === '') {
    return { isPrivate: true, url: '' };
  }
  const signedUrl = await getPrivateFilePresignedUrl(row.id);
  return { isPrivate: true, url: signedUrl || '' };
}

/**
 * 打开预览或下载链接，私有附件自动先获取限时授权地址。
 *
 * @param row 文件列表行记录
 */
async function handleOpenFile(row: InfraFileApi.File) {
  try {
    const { url } = await resolveFileAccessUrl(row);
    if (!url) {
      showErrorMessage('未获取到可用的文件访问地址');
      return;
    }
    openWindow(url);
  } catch {
    showErrorMessage('获取文件访问地址失败');
  }
}

const { copy } = useClipboard({ legacy: true });

/**
 * 复制链接到剪贴板，私有附件自动复制限时预签名链接并提示时效性。
 *
 * @param row 文件列表行记录
 */
async function handleCopyUrl(row: InfraFileApi.File) {
  try {
    const { isPrivate, url } = await resolveFileAccessUrl(row);
    if (!url) {
      showErrorMessage('文件 URL 为空');
      return;
    }
    await copy(url);
    showSuccessMessage(isPrivate ? '已复制限时授权链接' : '复制成功');
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
        /** 按当前页、筛选条件和表格排序查询列表。 */
        query: async ({ page, sorts }, formValues) => {
          return await getFilePage({
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
        <ElImage
          v-if="row.url && row.type && row.type.includes('image')"
          :src="row.url"
        />
        <ElButton type="primary" link @click="() => handleOpenFile(row)">
          {{
            row.type &&
            (row.type.includes('pdf') ||
              (!row.url && row.type.includes('image')))
              ? '预览'
              : '下载'
          }}
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
