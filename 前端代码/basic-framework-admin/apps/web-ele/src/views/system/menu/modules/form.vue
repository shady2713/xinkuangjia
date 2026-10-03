<script lang="ts" setup>
/**
 * 菜单新增/修改弹窗：按是否已存在主键决定走新增还是修改接口。
 */
import type { ComponentType } from '#/adapter/component';
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

const [Form, formApi] = useVbenForm<ComponentType, SystemMenuApi.Menu>({
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
  /**
   * 提交弹窗表单：校验通过后按是否存在主键选择新增或修改，并在结束时释放弹窗锁。
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
      await (formData.value?.id ? updateMenu(data) : createMenu(data));
      // 关闭并提示
      await modalApi.close();
      emit('success');
      ElMessage.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
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
      formData.value = await getMenu(data.id);
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
