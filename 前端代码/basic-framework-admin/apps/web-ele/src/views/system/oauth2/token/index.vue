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
  deleteOAuth2TokenList,
  getOAuth2TokenPage,
} from '#/api/system/oauth2/token';
import { useCrudDeleteActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';

import { useGridColumns, useGridFormSchema } from './data';

/** 刷新表格 */
function handleRefresh() {
  gridApi.query();
}

/**
 * 生成删除确认弹窗展示的令牌标识文本。
 *
 * @param row 令牌记录行
 * @returns 带井号前缀的令牌记录编号
 */
function formatTokenDeleteName(row: SystemOAuth2TokenApi.OAuth2Token) {
  return `#${row.id}`;
}

/**
 * 提取令牌记录主键用于单条与批量吊销。
 *
 * @param row 令牌记录行
 * @returns 令牌记录主键编号
 */
function resolveTokenRowKey(row: SystemOAuth2TokenApi.OAuth2Token) {
  return row.id;
}

const { checkedIds, handleDelete, handleDeleteBatch, handleRowCheckboxChange } =
  useCrudDeleteActions<SystemOAuth2TokenApi.OAuth2Token, number>({
    batchDeleteApi: deleteOAuth2TokenList,
    deleteApi: deleteOAuth2Token,
    getDeleteName: formatTokenDeleteName,
    getRowKey: resolveTokenRowKey,
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
      keyField: 'id',
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
                title: $t('ui.actionMessage.deleteConfirm', [`#${row.id}`]),
                confirm: handleDelete.bind(null, row),
              },
            },
          ]"
        />
      </template>
    </Grid>
  </Page>
</template>
