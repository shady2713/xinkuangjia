<script lang="ts" setup>
/**
 * 重置用户密码弹窗：只提交新密码，不回显原密码。
 */
import type { ComponentType } from '#/adapter/component';
import type { SystemUserApi } from '#/api/system/user';

import { useVbenModal } from '@vben/common-ui';
import { md5 } from '@vben/utils';

import { ElMessage } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { resetUserPassword } from '#/api/system/user';
import { $t } from '#/locales';

import { useResetPasswordFormSchema } from '../data';

/** 重置密码表单值：用户编号与新密码。 */
type ResetPasswordForm = {
  id: number;
  newPassword: string;
};

const emit = defineEmits(['success']);
const [Form, formApi] = useVbenForm<ComponentType, ResetPasswordForm>({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    formItemClass: 'col-span-2',
    labelWidth: 80,
  },
  layout: 'horizontal',
  schema: useResetPasswordFormSchema(),
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  /**
   * 提交新密码：校验通过后调用重置接口，成功后关闭弹窗。
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
      await resetUserPassword(data.id, md5(data.newPassword));
      // 关闭并提示
      await modalApi.close();
      emit('success');
      ElMessage.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  /**
   * 打开弹窗时记录目标用户；关闭时不做任何事，避免误清空已填的新密码。
   * @param isOpen 当前弹窗是否打开。
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      return;
    }
    // 加载数据
    const data = modalApi.getData<SystemUserApi.User>();
    if (!data || !data.id) {
      return;
    }
    // 弹窗只回填用户编号，新密码始终由用户在表单中重新输入。
    await formApi.setValues({ id: data.id, newPassword: '' });
  },
});
</script>

<template>
  <Modal title="重置密码">
    <Form class="mx-4" />
  </Modal>
</template>
