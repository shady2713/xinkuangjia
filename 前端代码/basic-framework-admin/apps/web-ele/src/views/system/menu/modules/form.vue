<script lang="ts" setup>
/** 系统菜单新增与编辑弹窗组件。 */
import type { SystemMenuApi } from '#/api/system/menu';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { ElMessage } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { createMenu, getMenu, updateMenu } from '#/api/system/menu';
import { $t } from '#/locales';

import { useFormSchema } from '../data';

const emit = defineEmits(['success']);
const formData = ref<SystemMenuApi.Menu>();

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
  /** 校验表单并保存系统菜单，失败时仍释放弹窗锁。 */
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    try {
      // 提交表单
      const data = (await formApi.getValues()) as SystemMenuApi.Menu;
      await (formData.value?.id ? updateMenu(data) : createMenu(data));
      // 关闭并提示
      await modalApi.close();
      emit('success');
      ElMessage.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  /**
   * 弹窗开关切换时初始化菜单表单数据并加载编辑详情。
   *
   * @param isOpen 弹窗是否处于打开状态
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      return;
    }
    const data = modalApi.getData<SystemMenuApi.Menu>();
    const isEdit = data?.id;
    modalApi.setState({
      title: isEdit
        ? $t('ui.actionTitle.edit', ['菜单'])
        : $t('ui.actionTitle.create', ['菜单']),
    });
    if (!isEdit) {
      // 设置上级
      await formApi.setValues(data);
      return;
    }
    formData.value = data;
    modalApi.lock();
    try {
      formData.value = await getMenu(isEdit);
      // 设置到 values
      await formApi.setValues(formData.value);
    } finally {
      modalApi.unlock();
    }
  },
});
</script>

<template>
  <Modal class="w-2/5">
    <Form class="mx-4" />
  </Modal>
</template>
