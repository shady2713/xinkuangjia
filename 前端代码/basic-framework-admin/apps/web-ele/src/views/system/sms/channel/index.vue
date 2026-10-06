<script lang="ts" setup>
/** 短信渠道管理页面 */
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemSmsChannelApi } from '#/api/system/sms/channel';

import { Page, useVbenModal } from '@vben/common-ui';

import { ACTION_ICON, TableAction, useVbenVxeGrid } from '#/adapter/vxe-table';
import { deleteSmsChannel, getSmsChannelPage } from '#/api/system/sms/channel';
import { useCrudItemActions } from '#/composables/use-crud-actions';
import { $t } from '#/locales';

import { useGridColumns, useGridFormSchema } from './data';
import Form from './modules/form.vue';

const [FormModal, formModalApi] = useVbenModal({
  connectedComponent: Form,
  destroyOnClose: true,
});

/** 刷新表格 */
function handleRefresh() {
  gridApi.query();
}

const { handleCreate, handleDelete, handleEdit } =
  useCrudItemActions<SystemSmsChannelApi.Channel>({
    deleteApi: deleteSmsChannel,
    /** 二次确认与成功提示中展示的渠道签名；取不到签名时退化为不带名称的通用文案。 */
    getDeleteName: (row) => row.signature || '',
    // 列表接口未返回 id 的异常行以 NaN 占位；批量勾选路径会按非有限数值过滤掉这类行
    getRowKey: (row) => row.id ?? Number.NaN,
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
        /** 分页查询短信渠道：页码与每页条数取自表格分页，检索条件由搜索表单透传。 */
        query: async ({ page }, formValues) => {
          return await getSmsChannelPage({
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
  } as VxeTableGridOptions<SystemSmsChannelApi.Channel>,
});
</script>

<template>
  <Page auto-content-height>
    <FormModal @success="handleRefresh" />
    <Grid table-title="短信渠道列表">
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {
              label: $t('ui.actionTitle.create', ['短信渠道']),
              type: 'primary',
              icon: ACTION_ICON.ADD,
              auth: ['system:sms-channel:create'],
              onClick: handleCreate,
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
              auth: ['system:sms-channel:update'],
              onClick: handleEdit.bind(null, row),
            },
            {
              label: $t('common.delete'),
              type: 'danger',
              link: true,
              icon: ACTION_ICON.DELETE,
              auth: ['system:sms-channel:delete'],
              popConfirm: {
                title: $t('ui.actionMessage.deleteConfirm', [row.signature]),
                confirm: handleDelete.bind(null, row),
              },
            },
          ]"
        />
      </template>
    </Grid>
  </Page>
</template>
