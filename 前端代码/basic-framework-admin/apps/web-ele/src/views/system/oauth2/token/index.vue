<script lang="ts" setup>
/** OAuth2.0 令牌管理页面 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemOAuth2TokenApi } from '#/api/system/oauth2/token';

import { Page } from '@vben/common-ui';
import { buildSortingField } from '@vben/request';
import { isEmpty } from '@vben/utils';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteOAuth2Token,
  getOAuth2TokenPage,
} from '#/api/system/oauth2/token';
import { useCrudDeleteActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';

import { useGridColumns, useGridFormSchema } from './data';

/** 刷新表格 */
function handleRefresh() {
  gridApi.query();
}

const { checkedIds, handleDelete, handleDeleteBatch, handleRowCheckboxChange } =
  useCrudDeleteActions<SystemOAuth2TokenApi.OAuth2Token, string>({
    // 批量删除时把令牌列表拼成接口参数
    batchDeleteApi: async (tokens) => deleteOAuth2Token(tokens.join(',')),
    deleteApi: deleteOAuth2Token,
    // 删除确认文案中的对象名称
    getDeleteName: () => '令牌',
    // 用访问令牌作为行主键
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
        /** 按当前页、筛选条件和表格排序查询列表。 */
        query: async ({ page, sorts }, formValues) => {
          return await getOAuth2TokenPage({
            pageNo: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
            ...buildSortingField(sorts),
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
