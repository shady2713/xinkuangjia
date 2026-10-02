<script lang="ts" setup>
import type { SystemSmsChannelApi } from '#/api/system/sms/channel';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { ElMessage } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import {
  createSmsChannel,
  getSmsChannel,
  updateSmsChannel,
} from '#/api/system/sms/channel';
import { $t } from '#/locales';

import { useFormSchema } from '../data';

const emit = defineEmits(['success']);
const formData = ref<SystemSmsChannelApi.Channel>();

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    formItemClass: 'col-span-2',
    labelWidth: 100,
  },
  layout: 'horizontal',
  schema: useFormSchema(),
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  /** 校验并保存短信渠道，成功后关闭弹窗并通知列表刷新；失败时释放弹窗锁。 */
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    const data = (await formApi.getValues()) as SystemSmsChannelApi.Channel;
    try {
      await (formData.value?.id
        ? updateSmsChannel(data)
        : createSmsChannel(data));
      await modalApi.close();
      emit('success');
      ElMessage.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  /**
   * 打开编辑弹窗时根据已校验的编号加载短信渠道；关闭时清理上一条记录。
   * @param isOpen 当前弹窗是否打开
   * @returns 异步初始化结果；请求失败仍会释放弹窗锁
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      return;
    }
    const data = modalApi.getData<SystemSmsChannelApi.Channel>();
    const isEdit = data?.id;
    modalApi.setState({
      title: isEdit
        ? $t('ui.actionTitle.edit', ['短信渠道'])
        : $t('ui.actionTitle.create', ['短信渠道']),
    });
    if (!isEdit) {
      return;
    }
    formData.value = data;
    modalApi.lock();
    try {
      formData.value = await getSmsChannel(isEdit);
      await formApi.setValues(formData.value);
    } finally {
      modalApi.unlock();
    }
  },
});
</script>

<template>
  <Modal class="w-[600px]">
    <Form class="mx-4" />
  </Modal>
</template>
