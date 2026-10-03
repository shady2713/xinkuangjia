<script lang="ts" setup>
/**
 * 用户导入弹窗：上传 Excel 后展示新增、更新与失败明细，不阻断列表刷新。
 */
import type { ComponentType } from '#/adapter/component';

import { useVbenModal } from '@vben/common-ui';
import { downloadFileFromBlobPart } from '@vben/utils';

import { ElButton, ElMessageBox, ElUpload } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { importUser, importUserTemplate } from '#/api/system/user';
import { $t } from '#/locales';
import { showSuccessMessage } from '#/utils/feedback';

import { useImportFormSchema } from '../data';

/** 导入表单值：待导入文件与是否允许更新已存在用户。 */
type ImportForm = {
  file: File;
  updateSupport: boolean;
};

const emit = defineEmits(['success']);

const [Form, formApi] = useVbenForm<ComponentType, ImportForm>({
  commonConfig: {
    formItemClass: 'col-span-2',
    labelWidth: 120,
  },
  layout: 'horizontal',
  schema: useImportFormSchema(),
  showDefaultActions: false,
});

/**
 * 转义 HTML，避免用户名中的特殊字符破坏导入结果弹窗的结构。
 * @param value 待转义的原始文本。
 * @returns 转义后可安全插入 HTML 的文本。
 */
function escapeHtml(value: string) {
  return value.replaceAll(
    /[&<>"']/g,
    /**
     * 把单个特殊字符替换为对应的 HTML 实体。
     * @param c 当前匹配的字符。
     * @returns 对应的 HTML 实体文本。
     */
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] as string,
  );
}

const [Modal, modalApi] = useVbenModal({
  /**
   * 提交导入文件：未选择文件时直接返回，避免提交空文件请求。
   */
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    // 提交表单
    const data = await formApi.getValues();
    try {
      const result = await importUser(data.file, data.updateSupport);
      const createCount = result?.createUsernames?.length ?? 0;
      const updateCount = result?.updateUsernames?.length ?? 0;
      const failureEntries = Object.entries(result?.failureUsernames ?? {});
      const failureCount = failureEntries.length;

      // 关闭弹窗并刷新列表
      await modalApi.close();
      emit('success');

      if (failureCount > 0) {
        // 有失败时使用 MessageBox 展示明细，避免被 Message 截断
        const failureItems = failureEntries
          .map(
            /**
             * 把一条失败明细渲染成列表项，用户名与提示都先转义。
             * @param entry 后端返回的“用户名 + 失败原因”二元组。
             * @returns 形如“用户名：失败原因”的列表项 HTML。
             */
            (entry) => {
              const [username, msg] = entry;
              return `<li>${escapeHtml(username)}：${escapeHtml(String(msg))}</li>`;
            },
          )
          .join('');
        ElMessageBox.alert(
          `<div>
            <p>新增 ${createCount} 个，更新 ${updateCount} 个，失败 ${failureCount} 个。失败明细：</p>
            <ul style="max-height: 300px; overflow-y: auto; padding-left: 20px; margin: 8px 0 0;">${failureItems}</ul>
          </div>`,
          '导入结果',
          {
            confirmButtonText: '确定',
            dangerouslyUseHTMLString: true,
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

/** 上传组件回传的原始文件项：只有 raw 是真正要落库的文件。 */
type UploadChangeItem = { raw?: File };

/** 文件改变时：只取原始文件写入表单，组件附加的状态字段一律不落库。 */
function handleChange(file: UploadChangeItem) {
  if (file.raw) {
    formApi.setFieldValue('file', file.raw);
  }
}

/** 下载模版 */
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
