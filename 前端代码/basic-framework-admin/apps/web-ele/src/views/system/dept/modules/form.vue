<script lang="ts" setup>
import type { SystemDeptApi } from '#/api/system/dept';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { ElMessage } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { createDept, getDept, updateDept } from '#/api/system/dept';
import { $t } from '#/locales';

import { useFormSchema } from '../data';

const emit = defineEmits(['success']);
const formData = ref<SystemDeptApi.Dept>();

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    formItemClass: 'col-span-2',
    labelWidth: 80,
  },
  layout: 'horizontal',
  schema: useFormSchema(),
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  /** 校验部门表单并归一化空负责人后提交；失败时仍释放弹窗锁。 */
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    // 提交表单
    const data = (await formApi.getValues()) as SystemDeptApi.Dept;
    // 表单清空选择器时可能返回空字符串，先按外部输入收窄后统一为 null。
    const leaderUserId: unknown = data.leaderUserId;
    if (
      leaderUserId === undefined ||
      leaderUserId === null ||
      leaderUserId === ''
    ) {
      data.leaderUserId = null;
    }
    try {
      await (formData.value?.id ? updateDept(data) : createDept(data));
      // 关闭并提示
      await modalApi.close();
      emit('success');
      ElMessage.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  /**
   * 打开编辑弹窗时根据已校验的编号加载部门；关闭时清理上一条记录。
   * @param isOpen 当前弹窗是否打开
   * @returns 异步初始化结果；请求失败仍会释放弹窗锁
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      return;
    }
    const data = modalApi.getData<SystemDeptApi.Dept>();
    const isEdit = data?.id;
    modalApi.setState({
      title: isEdit
        ? $t('ui.actionTitle.edit', ['部门'])
        : $t('ui.actionTitle.create', ['部门']),
    });
    if (!isEdit) {
      // 设置上级
      await formApi.setValues(data);
      return;
    }
    formData.value = data;
    modalApi.lock();
    try {
      formData.value = await getDept(isEdit);
      // 设置到 values
      await formApi.setValues(formData.value);
    } finally {
      modalApi.unlock();
    }
  },
});
</script>

<template>
  <Modal>
    <Form class="mx-4" />
  </Modal>
</template>
