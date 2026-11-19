<script lang="ts" setup>
/** 定时任务详情弹窗组件，展示任务基础配置与下一次执行时间序列。 */
import type { InfraJobApi } from '#/api/infra/job';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { getJob, getJobNextTimes } from '#/api/infra/job';
import { useDescription } from '#/components/description';

import { useDetailSchema } from '../data';

const formData = ref<InfraJobApi.Job>(); // 任务详情

const [Descriptions] = useDescription({
  border: true,
  column: 1,
  schema: useDetailSchema(),
});

const [Modal, modalApi] = useVbenModal({
  /**
   * 弹窗开关切换时按任务编号加载详情与未来执行时间序列；关闭时清理状态。
   *
   * @param isOpen 弹窗是否处于打开状态
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      return;
    }
    // 加载数据
    const data = modalApi.getData<{ id: number | string }>();
    if (!data?.id) {
      return;
    }
    modalApi.lock();
    try {
      const job = await getJob(data.id);
      job.nextTimes = await getJobNextTimes(data.id);
      formData.value = job;
    } finally {
      modalApi.unlock();
    }
  },
});
</script>

<template>
  <Modal
    title="任务详情"
    class="w-1/2"
    :show-cancel-button="false"
    :show-confirm-button="false"
  >
    <Descriptions :data="formData" />
  </Modal>
</template>
