<script lang="ts" setup>
/** 用户 Excel 导入弹窗组件，提供模板下载、覆盖开关及安全 VNode 错误明细展示。 */
import { h } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { downloadFileFromBlobPart } from '@vben/utils';

import { ElButton, ElMessageBox, ElUpload } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { importUser, importUserTemplate } from '#/api/system/user';
import { $t } from '#/locales';
import { showSuccessMessage } from '#/utils/feedback';

import { useImportFormSchema } from '../data';

const emit = defineEmits(['success']);

const [Form, formApi] = useVbenForm({
  commonConfig: {
    formItemClass: 'col-span-2',
    labelWidth: 120,
  },
  layout: 'horizontal',
  schema: useImportFormSchema(),
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  /** 校验并上传用户导入文件；存在失败行时以安全 VNode 弹窗展示逐行明细。 */
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    try {
      const data = await formApi.getValues();
      const result = await importUser(data.file, data.updateSupport);
      const createCount = result?.createUsernames?.length ?? 0;
      const updateCount = result?.updateUsernames?.length ?? 0;
      const failureEntries = Object.entries(result?.failureUsernames ?? {});
      const failureCount = failureEntries.length;

      await modalApi.close();
      emit('success');

      if (failureCount > 0) {
        const failureNodes = failureEntries.map(([username, msg]) =>
          h('li', { key: username }, `${username}：${String(msg)}`),
        );
        ElMessageBox.alert(
          h('div', [
            h(
              'p',
              `新增 ${createCount} 个，更新 ${updateCount} 个，失败 ${failureCount} 个。失败明细：`,
            ),
            h(
              'ul',
              {
                style: {
                  margin: '8px 0 0',
                  maxHeight: '300px',
                  overflowY: 'auto',
                  paddingLeft: '20px',
                },
              },
              failureNodes,
            ),
          ]),
          '导入结果',
          {
            confirmButtonText: '确定',
            type: 'warning',
          },
        );
      } else {
        showSuccessMessage(
          `${$t('ui.actionMessage.operationSuccess')}：新增 ${createCount} 个，更新 ${updateCount} 个`,
        );
      }
    } finally {
      modalApi.unlock();
    }
  },
});

/** 选择上传文件后同步到表单状态。 */
function handleChange(file: any) {
  if (file.raw) {
    formApi.setFieldValue('file', file.raw as File);
  }
}

/** 从待上传列表移除文件后清空表单绑定值，防止继续提交旧文件。 */
function handleRemove() {
  formApi.setFieldValue('file', undefined);
}

/** 下载用户导入模板。 */
async function handleDownload() {
  const data = await importUserTemplate();
  downloadFileFromBlobPart({ fileName: '用户导入模板.xls', source: data });
}
</script>

<template>
  <Modal title="导入用户" class="w-1/3">
    <Form class="mx-4">
      <template #file>
        <div class="w-full">
          <ElUpload
            :limit="1"
            accept=".xls,.xlsx"
            :on-change="handleChange"
            :on-remove="handleRemove"
            :auto-upload="false"
          >
            <ElButton type="primary"> 选择 Excel 文件 </ElButton>
          </ElUpload>
        </div>
      </template>
    </Form>
    <template #prepend-footer>
      <div class="flex flex-auto items-center">
        <ElButton @click="handleDownload"> 下载导入模板 </ElButton>
      </div>
    </template>
  </Modal>
</template>
