<script setup lang="ts">
/** 忘记密码表单：只负责收集与校验输入，提交动作通过 submit 事件交给调用方。 */
import type { Recordable } from '@vben/types';

import type { VbenFormSchema } from '@vben-core/form-ui';

import { computed, reactive } from 'vue';
import { useRouter } from 'vue-router';

import { $t } from '@vben/locales';

import { useVbenForm } from '@vben-core/form-ui';
import { VbenButton } from '@vben-core/shadcn-ui';

import Title from './auth-title.vue';

interface Props {
  formSchema: VbenFormSchema[];
  /**
   * @zh_CN 是否处于加载处理状态
   */
  loading?: boolean;
  /**
   * @zh_CN 登录路径
   */
  loginPath?: string;
  /**
   * @zh_CN 标题
   */
  title?: string;
  /**
   * @zh_CN 描述
   */
  subTitle?: string;
  /**
   * @zh_CN 按钮文本
   */
  submitButtonText?: string;
}

defineOptions({
  name: 'ForgetPassword',
});

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  loginPath: '/auth/login',
  submitButtonText: '',
  subTitle: '',
  title: '',
});

const emit = defineEmits<{
  /** 校验通过后回传整表值；字段集合由 formSchema 决定，组件本身不做约束。 */
  submit: [Recordable<unknown>];
}>();

const [Form, formApi] = useVbenForm(
  reactive({
    commonConfig: {
      hideLabel: true,
      hideRequiredMark: true,
    },
    schema: computed(() => props.formSchema),
    showDefaultActions: false,
  }),
);

const router = useRouter();

async function handleSubmit() {
  const { valid } = await formApi.validate();
  const values = await formApi.getValues();
  if (valid) {
    emit('submit', values);
  }
}

function goToLogin() {
  router.push(props.loginPath);
}

defineExpose({
  getFormApi: () => formApi,
});
</script>

<template>
  <div>
    <Title>
      <slot name="title">
        {{ title || $t('authentication.forgetPassword') }} 🤦🏻‍♂️
      </slot>
      <template #desc>
        <slot name="subTitle">
          {{ subTitle || $t('authentication.forgetPasswordSubtitle') }}
        </slot>
      </template>
    </Title>
    <Form />

    <div>
      <VbenButton
        :class="{
          'cursor-wait': loading,
        }"
        aria-label="submit"
        class="mt-2 w-full"
        @click="handleSubmit"
      >
        <slot name="submitButtonText">
          {{ submitButtonText || $t('authentication.resetPassword') }}
        </slot>
      </VbenButton>
      <VbenButton class="mt-4 w-full" variant="outline" @click="goToLogin()">
        {{ $t('common.back') }}
      </VbenButton>
    </div>
  </div>
</template>
