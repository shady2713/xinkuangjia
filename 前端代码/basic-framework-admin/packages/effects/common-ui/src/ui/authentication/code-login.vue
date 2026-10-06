<script setup lang="ts">
/**
 * 验证码登录界面：渲染调用方传入的表单结构，校验通过后把表单值交给上层。
 * 只负责校验、提交事件与返回登录页的跳转；验证码发送与登录请求由使用方处理。
 */
import type { Recordable } from '@vben/types';

import type { VbenFormSchema } from '@vben-core/form-ui';

import { computed, reactive } from 'vue';
import { useRouter } from 'vue-router';

import { $t } from '@vben/locales';

import { useVbenForm } from '@vben-core/form-ui';
import { VbenButton } from '@vben-core/shadcn-ui';

import Title from './auth-title.vue';

/** 验证码登录属性：表单结构、加载态、登录路径与标题描述，以及按钮文案和返回按钮开关。 */
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
  /**
   * @zh_CN 是否显示返回按钮
   */
  showBack?: boolean;
}

defineOptions({
  name: 'AuthenticationCodeLogin',
});

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  showBack: true,
  loginPath: '/auth/login',
  submitButtonText: '',
  subTitle: '',
  title: '',
});

const emit = defineEmits<{
  submit: [Recordable<unknown>];
}>();

const router = useRouter();

const [Form, formApi] = useVbenForm(
  reactive({
    commonConfig: {
      hideLabel: true,
      hideRequiredMark: true,
    },
    /** 表单结构：直接沿用调用方传入的字段定义，随 props 变化重建。 */
    schema: computed(() => props.formSchema),
    showDefaultActions: false,
  }),
);

/** 提交：校验并取值，只有校验通过才把表单值抛给上层；不通过时不抛事件。 */
async function handleSubmit() {
  const { valid } = await formApi.validate();
  const values = await formApi.getValues();
  if (valid) {
    emit('submit', values);
  }
}

/** 返回登录页；目标路径由 props.loginPath 决定。 */
function goToLogin() {
  router.push(props.loginPath);
}

defineExpose({
  /** 暴露内部表单 API，供上层主动取值、设值或触发表单校验。 */
  getFormApi: () => formApi,
});
</script>

<template>
  <div>
    <Title>
      <slot name="title">
        {{ title || $t('authentication.welcomeBack') }} 📲
      </slot>
      <template #desc>
        <span class="text-muted-foreground">
          <slot name="subTitle">
            {{ subTitle || $t('authentication.codeSubtitle') }}
          </slot>
        </span>
      </template>
    </Title>
    <Form />
    <VbenButton
      :class="{
        'cursor-wait': loading,
      }"
      :loading="loading"
      class="w-full"
      @click="handleSubmit"
    >
      <slot name="submitButtonText">
        {{ submitButtonText || $t('common.login') }}
      </slot>
    </VbenButton>
    <VbenButton
      v-if="showBack"
      class="mt-4 w-full"
      variant="outline"
      @click="goToLogin()"
    >
      {{ $t('common.back') }}
    </VbenButton>
  </div>
</template>
