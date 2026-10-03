<script lang="ts" setup>
/** OAuth2.0 客户端管理页面 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemOAuth2ClientApi } from '#/api/system/oauth2/client';

import { Page, useVbenModal } from '@vben/common-ui';
import { isEmpty } from '@vben/utils';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteOAuth2Client,
  deleteOAuth2ClientList,
  getOAuth2ClientPage,
} from '#/api/system/oauth2/client';
import { useCrudActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';

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
  handleCreate,
  handleDelete,
  handleDeleteBatch,
  handleEdit,
} = useCrudActions<SystemOAuth2ClientApi.OAuth2Client>({
  batchDeleteApi: deleteOAuth2ClientList,
  deleteApi: deleteOAuth2Client,
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
          return await getOAuth2ClientPage({
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
  } as VxeTableGridOptions<SystemOAuth2ClientApi.OAuth2Client>,
  gridEvents: getGridEvents(),
});
</script>

<template>
  <Page auto-content-height>
    <FormModal @success="handleRefresh" />
    <Grid table-title="OAuth2 客户端列表">
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: $t('ui.actionTitle.create', [' OAuth2.0 客户端']),
              type: 'primary',
              icon: ACTION_ICON.ADD,
              auth: ['system:oauth2-client:create'],
              onClick: handleCreate,
            },
            {
              label: $t('ui.actionTitle.deleteBatch'),
              type: 'danger',
              icon: ACTION_ICON.DELETE,
              auth: ['system:oauth2-client:delete'],
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
              auth: ['system:oauth2-client:update'],
              onClick: handleEdit.bind(null, row),
            },
            {
              label: $t('common.delete'),
              type: 'danger',
              link: true,
              icon: ACTION_ICON.DELETE,
              auth: ['system:oauth2-client:delete'],
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
