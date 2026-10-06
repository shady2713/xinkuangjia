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
  /**
   * 弹窗开关时按传入的任务编号加载任务定义与后续执行时间，关闭时清空已展示的数据。
   * 编号缺失时保持空描述区而不发请求；加载期间锁定弹窗，加载结束后解锁。
   * @param isOpen 弹窗当前是否打开，打开时加载数据，关闭时释放本地状态。
   */
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
