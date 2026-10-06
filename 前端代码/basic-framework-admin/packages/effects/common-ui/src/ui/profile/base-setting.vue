<script setup lang="ts">
/**
 * 个人资料的基础信息表单：按外部传入的 schema 渲染字段并做提交前校验。
 * 校验通过后经 submit 事件抛出表单值，保存请求由调用页面负责。
 */
import type { Recordable } from '@vben/types';

import type { VbenFormSchema } from '@vben-core/form-ui';

import { computed, reactive } from 'vue';

import { $t } from '@vben/locales';

import { useVbenForm } from '@vben-core/form-ui';
import { VbenButton } from '@vben-core/shadcn-ui';

/** 基础信息表单属性：字段结构由调用方传入。 */
interface Props {
  formSchema?: VbenFormSchema[];
}

const props = withDefaults(defineProps<Props>(), {
  /** 表单结构默认值：空数组，未传入时表单没有字段。 */
  formSchema: () => [],
});

const emit = defineEmits<{
  submit: [Recordable<unknown>];
}>();

const [Form, formApi] = useVbenForm(
  reactive({
    commonConfig: {
      // 所有表单项
      componentProps: {
        class: 'w-full',
      },
    },
    layout: 'horizontal',
    /** 表单结构：直接沿用调用方传入的字段定义，随 props 变化重建。 */
    schema: computed(() => props.formSchema),
    showDefaultActions: false,
  }),
);

/** 提交：校验并取值，只有校验通过才抛 submit；保存请求由调用页面负责。 */
async function handleSubmit() {
  const { valid } = await formApi.validate();
  const values = await formApi.getValues();
  if (valid) {
    emit('submit', values);
  }
}

defineExpose({
  /** 暴露内部表单 API，供调用页面主动取值、设值或触发表单校验。 */
  getFormApi: () => formApi,
});
</script>
<template>
  <div @keydown.enter.prevent="handleSubmit">
    <Form />
    <VbenButton type="submit" class="mt-4" @click="handleSubmit">
      {{ $t('profile.updateBasicProfile') }}
    </VbenButton>
  </div>
</template>
