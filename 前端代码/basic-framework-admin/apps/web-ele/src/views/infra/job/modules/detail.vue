<script lang="ts" setup>
/**
 * 定时任务详情弹窗：展示任务定义，并额外拉取后端推算的下次执行时间。
 * 下次执行时间回填到表单数据供描述项读取；任务编辑由同级 form.vue 负责。
 */
import type { InfraJobApi } from '#/api/infra/job';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { getJob, getJobNextTimes } from '#/api/infra/job';
import { useDescription } from '#/components/description';

import { useDetailSchema } from '../data';

const formData = ref<InfraJobApi.Job>(); // 任务详情
const nextTimes = ref<number[]>([]); // 后端序列化的下次执行毫秒时间

const [Descriptions] = useDescription({
  border: true,
  column: 1,
  schema: useDetailSchema(),
});

const [Modal, modalApi] = useVbenModal({
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      formData.value = undefined;
      return;
    }
    // 加载数据
    const data = modalApi.getData<{ id: number }>();
    if (!data?.id) {
      return;
    }
    modalApi.lock();
    try {
      formData.value = await getJob(data.id);
      // 获取下一次执行时间
      nextTimes.value = await getJobNextTimes(data.id);
      // 将 nextTimes 赋值给 formData，以便在 schema 中使用
      formData.value.nextTimes = nextTimes.value;
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
