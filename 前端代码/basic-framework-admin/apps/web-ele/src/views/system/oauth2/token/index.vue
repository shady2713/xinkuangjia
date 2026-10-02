<script lang="ts" setup>
/** OAuth2.0 令牌管理页面 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemOAuth2TokenApi } from '#/api/system/oauth2/token';

import { Page } from '@vben/common-ui';
import { isEmpty } from '@vben/utils';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import { useCrudDeleteActions } from '#/composables/use-crud-actions';
import {
  deleteOAuth2Token,
  getOAuth2TokenPage,
} from '#/api/system/oauth2/token';
import { $t } from '#/locales';

import { useGridColumns, useGridFormSchema } from './data';

/** 刷新表格 */
function handleRefresh() {
  gridApi.query();
}

const {
  checkedIds,
  handleDelete,
  handleDeleteBatch,
  handleRowCheckboxChange,
} = useCrudDeleteActions<SystemOAuth2TokenApi.OAuth2Token, string>({
  batchDeleteApi: async (tokens) => deleteOAuth2Token(tokens.join(',')),
  deleteApi: deleteOAuth2Token,
  getDeleteName: () => '令牌',
  getRowKey: (row) => row.accessToken,
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
          return await getOAuth2TokenPage({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
          });
        },
      },
    },
    rowConfig: {
      keyField: 'accessToken',
      isHover: true,
    },
    toolbarConfig: {
      refresh: true,
      search: true,
    },
  } as VxeTableGridOptions<SystemOAuth2TokenApi.OAuth2Token>,
  gridEvents: {
    checkboxAll: handleRowCheckboxChange,
    checkboxChange: handleRowCheckboxChange,
  },
});
</script>

<template>
  <Page auto-content-height>
    <Grid table-title="令牌列表">
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: $t('ui.actionTitle.deleteBatch'),
              type: 'danger',
              icon: ACTION_ICON.DELETE,
              auth: ['system:oauth2-token:delete'],
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
              label: $t('common.delete'),
              type: 'danger',
              link: true,
              icon: ACTION_ICON.DELETE,
              auth: ['system:oauth2-token:delete'],
              popConfirm: {
                title: $t('ui.actionMessage.deleteConfirm', ['令牌']),
                confirm: handleDelete.bind(null, row),
              },
            },
          ]"
        />
      </template>
    </Grid>
  </Page>
</template>
