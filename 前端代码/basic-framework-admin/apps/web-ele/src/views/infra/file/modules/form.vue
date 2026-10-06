<script lang="ts" setup>
/**
 * 文件上传弹窗：选择单个图片后统一提交，成功后关闭并通知父级刷新。
 *
 * 关闭自动上传，由 onConfirm 提交以避免选中即传的重复请求；
 * 上传地址与请求头由 upload 组件的 useUpload 提供。
 */
import type { UploadFile, UploadRawFile } from 'element-plus';

/**
 * 文件上传弹窗：选择本地文件后上传，并回传服务器返回的文件访问地址。
 */
import type { ComponentType } from '#/adapter/component';

import { useVbenModal } from '@vben/common-ui';

import { ElUpload } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { useUpload } from '#/components/upload/use-upload';
import { $t } from '#/locales';
import { showSuccessMessage, showWarningMessage } from '#/utils/feedback';

import { useFormSchema } from '../data';

/** 上传表单值：待上传的原始文件。 */
type UploadForm = {
  file: File;
};

const emit = defineEmits(['success']);

const [Form, formApi] = useVbenForm<ComponentType, UploadForm>({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    formItemClass: 'col-span-2',
    labelWidth: 80,
    hideLabel: true,
  },
  layout: 'horizontal',
  schema: useFormSchema().map(
    // 上传区不需要字段标签：表单项本身就是上传控件。
    (item) => ({ ...item, label: '' }),
  ),
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  /**
   * 提交待上传文件：未选择文件时直接返回，避免提交空文件请求。
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
      await useUpload().httpRequest(data.file);
      // 关闭并提示
      await modalApi.close();
      emit('success');
      showSuccessMessage($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
});

/** 文件变化处理 */
function handleChange(uploadFile: UploadFile) {
  if (uploadFile.raw) {
    formApi.setFieldValue('file', uploadFile.raw);
  }
}

/** 文件数量超出限制 */
function handleExceed() {
  showWarningMessage('最多只能上传一个文件');
}

/** 上传前校验：不自动上传，仅保存文件 */
function beforeUpload(_rawFile: UploadRawFile) {
  return false;
}
</script>

<template>
  <Modal title="上传图片">
    <Form class="mx-4">
      <template #file>
        <div class="w-full">
          <ElUpload
            :auto-upload="false"
            :limit="1"
            :on-change="handleChange"
            :on-exceed="handleExceed"
            :before-upload="beforeUpload"
            accept=".jpg,.png,.gif,.webp"
            drag
          >
            <div
              class="flex min-h-[200px] flex-col items-center justify-center py-8"
            >
              <span
                class="icon-[mdi--cloud-upload-outline] mb-4 text-6xl text-gray-400"
              ></span>
              <div class="text-base text-gray-600">
                点击或拖拽文件到此区域上传
              </div>
              <div class="mt-2 text-sm text-gray-400">
                支持 .jpg、.png、.gif、.webp 格式图片文件
              </div>
            </div>
          </ElUpload>
        </div>
      </template>
    </Form>
  </Modal>
</template>
