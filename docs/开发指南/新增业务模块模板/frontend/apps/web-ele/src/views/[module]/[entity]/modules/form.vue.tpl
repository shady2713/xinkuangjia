<script lang="ts" setup>
/**
 * [entity-name]新增/修改弹窗：按是否已存在主键决定走新增还是修改接口。
 *
 * 编辑数据由页面在打开前取好（见 index.vue 的 handleEdit），本组件只负责回填与提交：
 * 如果在本组件内异步拉取详情再回填，弹窗此时已经可以输入，慢请求会把用户刚输入的内容覆盖掉。
 */
import type { ComponentType } from '#/adapter/component';
import type { [Entity] } from '#/api/[module]/[entity]';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { ElMessage } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { create[Entity], get[Entity], update[Entity] } from '#/api/[module]/[entity]';
import { $t } from '#/locales';

import { useFormSchema } from '../data';

const emit = defineEmits(['success']);
const formData = ref<[Entity]>();

const [Form, formApi] = useVbenForm<ComponentType, [Entity]>({
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
      await (formData.value?.id === undefined
        ? create[Entity](data)
        : update[Entity](data));
      // 关闭并提示
      await modalApi.close();
      emit('success');
      ElMessage.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  /**
   * 打开时按编号加载详情并回填表单，关闭时清理上一条记录。
   *
   * 详情必须在本组件内、表单挂载之后回填：在弹窗打开之前 setValues 会被挂载时的默认值覆盖，
   * 隐藏的主键字段随之丢失，修改请求就会缺少编号。回填期间禁用输入，避免慢请求覆盖用户
   * 已经输入的内容；请求失败时在 finally 中恢复可编辑状态。
   *
   * @param isOpen 当前弹窗是否打开
   * @returns 回填完成后的异步结果
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      return;
    }
    const data = modalApi.getData<[Entity]>();
    const isEdit = data?.id;
    modalApi.setState({
      title: isEdit
        ? $t('ui.actionTitle.edit', ['[entity-name]'])
        : $t('ui.actionTitle.create', ['[entity-name]']),
    });
    if (!isEdit) {
      return;
    }
    formData.value = data;
    formApi.setDisabled(true);
    modalApi.lock();
    try {
      formData.value = await get[Entity](isEdit);
      await formApi.setValues(formData.value);
    } finally {
      formApi.setDisabled(false);
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
