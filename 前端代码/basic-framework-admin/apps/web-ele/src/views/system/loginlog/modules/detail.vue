<script lang="ts" setup>
/**
 * 登录日志详情弹窗：直接展示列表传入的整行日志，不再补发详情请求。
 * 字段与字典渲染由 ../data 的详情 schema 决定，弹窗只管显隐。
 */
import type { SystemLoginLogApi } from '#/api/system/login-log';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { useDescription } from '#/components/description';

import { useDetailSchema } from '../data';

const formData = ref<SystemLoginLogApi.LoginLog>();

const [Descriptions] = useDescription({
  border: true,
  column: 1,
  schema: useDetailSchema(),
});

const [Modal, modalApi] = useVbenModal({
  /**
   * 弹窗显隐回调：打开时直接取列表传入的整行日志作为展示数据，缺少主键时保持空展示；
   * 关闭时清空本地副本，避免下次打开残留上一次的日志。
   * @param isOpen 弹窗是否打开。
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      return;
    }
    // 加载数据
    const data = modalApi.getData<SystemLoginLogApi.LoginLog>();
    if (!data || !data.id) {
      return;
    }
    modalApi.lock();
    try {
      formData.value = data;
    } finally {
      modalApi.unlock();
    }
  },
});
</script>

<template>
  <Modal
    title="登录日志详情"
    class="w-1/2"
    :show-cancel-button="false"
    :show-confirm-button="false"
  >
    <Descriptions :data="formData" />
  </Modal>
</template>
