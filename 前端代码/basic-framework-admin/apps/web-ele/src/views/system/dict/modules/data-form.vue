<script lang="ts" setup>
/**
 * 字典数据新增/修改弹窗：按是否已存在主键决定走新增还是修改接口。
 */
import type { ComponentType } from '#/adapter/component';
import type { SystemDictDataApi } from '#/api/system/dict/data';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { ElMessage } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import {
  createDictData,
  getDictData,
  updateDictData,
} from '#/api/system/dict/data';
import { $t } from '#/locales';

import { useDataFormSchema } from '../data';

defineOptions({ name: 'SystemDictDataForm' });

const emit = defineEmits(['success']);
const formData = ref<SystemDictDataApi.DictData>();

const [Form, formApi] = useVbenForm<ComponentType, SystemDictDataApi.DictData>({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    formItemClass: 'col-span-2',
    labelWidth: 90,
  },
  layout: 'horizontal',
  schema: useDataFormSchema(),
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
      await (formData.value?.id ? updateDictData(data) : createDictData(data));
      // 关闭并提示
      await modalApi.close();
      emit('success');
      ElMessage.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  /**
   * 打开编辑弹窗时根据已校验的编号加载字典；关闭时清理上一条记录。
   * @param isOpen 当前弹窗是否打开
   * @returns 异步初始化结果；请求失败仍会释放弹窗锁
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      return;
    }
    const data = modalApi.getData<SystemDictDataApi.DictData>();
    const isEdit = data?.id;
    modalApi.setState({
      title: isEdit
        ? $t('ui.actionTitle.edit', ['字典数据'])
        : $t('ui.actionTitle.create', ['字典数据']),
    });
    if (!isEdit) {
      // 设置 dictType
      await formApi.setValues(data);
      return;
    }
    formData.value = data;
    modalApi.lock();
    try {
      formData.value = await getDictData(isEdit);
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
