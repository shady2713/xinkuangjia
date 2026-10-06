<script setup lang="ts">
/**
 * 密码设置表单：用 useVbenForm 渲染外层传入的密码字段。
 *
 * 校验通过后抛出全部字段值，并暴露 getFormApi 供外层重置或再校验；
 * 字段规则与提交请求分别由 formSchema 和页面持有。
 */
import type { Recordable } from '@vben/types';

import type { VbenFormSchema } from '@vben-core/form-ui';

import { computed, reactive } from 'vue';

import { $t } from '@vben/locales';

import { useVbenForm } from '@vben-core/form-ui';
import { VbenButton } from '@vben-core/shadcn-ui';

/** 修改密码表单属性：字段结构由调用方传入。 */
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
      labelWidth: 130,
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

/** 提交：校验并取值，只有校验通过才抛 submit；改密请求由调用页面负责。 */
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
  <div>
    <Form />
    <VbenButton type="submit" class="mt-4" @click="handleSubmit">
      {{ $t('profile.updatePassword') }}
    </VbenButton>
  </div>
</template>
