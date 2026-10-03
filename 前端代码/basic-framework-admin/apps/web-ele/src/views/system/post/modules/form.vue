<script lang="ts" setup>
/**
 * 岗位新增/修改弹窗：按是否已存在主键决定走新增还是修改接口。
 */
import type { ComponentType } from '#/adapter/component';
import type { SystemPostApi } from '#/api/system/post';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { ElMessage } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { createPost, getPost, updatePost } from '#/api/system/post';
import { $t } from '#/locales';

import { useFormSchema } from '../data';

const emit = defineEmits(['success']);
const formData = ref<SystemPostApi.Post>();

const [Form, formApi] = useVbenForm<ComponentType, SystemPostApi.Post>({
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
      await (formData.value?.id ? updatePost(data) : createPost(data));
      // 关闭并提示
      await modalApi.close();
      emit('success');
      ElMessage.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  /**
   * 打开编辑弹窗时根据已校验的编号加载岗位；关闭时清理上一条记录。
   * @param isOpen 当前弹窗是否打开
   * @returns 异步初始化结果；请求失败仍会释放弹窗锁
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      return;
    }
    const data = modalApi.getData<SystemPostApi.Post>();
    const isEdit = data?.id;
    modalApi.setState({
      title: isEdit
        ? $t('ui.actionTitle.edit', ['岗位'])
        : $t('ui.actionTitle.create', ['岗位']),
    });
    if (!isEdit) {
      return;
    }
    formData.value = data;
    modalApi.lock();
    try {
      formData.value = await getPost(isEdit);
      // 设置到 values
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
