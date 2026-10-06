<script setup lang="ts">
/**
 * 账号密码登录界面：渲染调用方传入的表单结构，并管理“记住用户名”开关。
 * 校验通过后抛出 submit 事件；用户名按当前域名存入 localStorage 供下次回填。
 * 登录请求、错误提示与登录成功后的跳转均由使用方处理。
 */
import type { Recordable } from '@vben/types';

import type { BaseFormComponentType, VbenFormSchema } from '@vben-core/form-ui';

import type { AuthenticationProps } from './types';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { $t } from '@vben/locales';

import { useVbenForm } from '@vben-core/form-ui';
import { VbenButton, VbenCheckbox } from '@vben-core/shadcn-ui';

import Title from './auth-title.vue';

/** 登录界面属性：在认证页公共属性之上补充表单结构。 */
interface Props extends AuthenticationProps {
  formSchema?: VbenFormSchema[];
}

/**
 * 登录表单值。
 * 组件本身是通用的登录容器，这里只声明它自己直接使用的“记住用户名”字段；
 * 其余字段由调用方传入的 formSchema 决定，账号与密码保持开放键值。
 */
type LoginForm = {
  [key: string]: unknown;
  password?: string;
  rememberMe?: boolean;
  username?: string;
};

defineOptions({
  name: 'AuthenticationLogin',
});

const props = withDefaults(defineProps<Props>(), {
  codeLoginPath: '/auth/code-login',
  forgetPasswordPath: '/auth/forget-password',
  /** 表单结构默认值：空数组，未传入时表单没有字段。 */
  formSchema: () => [],
  loading: false,
  registerPath: '/auth/register',
  showCodeLogin: true,
  showForgetPassword: true,
  showRegister: true,
  showRememberMe: true,
  showThirdPartyLogin: true,
  submitButtonText: '',
  subTitle: '',
  title: '',
});

const emit = defineEmits<{
  submit: [Recordable<unknown>];
}>();

const [Form, formApi] = useVbenForm<BaseFormComponentType, LoginForm>(
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
const router = useRouter();

const REMEMBER_ME_KEY = `REMEMBER_ME_USERNAME_${location.hostname}`;

const localUsername = localStorage.getItem(REMEMBER_ME_KEY) || '';

const rememberMe = ref(!!localUsername);

/**
 * 提交登录表单。
 * 校验不通过时直接返回，不记忆用户名也不通知上层，避免把非法值带进登录请求。
 */
async function handleSubmit() {
  const { valid } = await formApi.validate();
  const values = await formApi.getValues();
  if (valid) {
    localStorage.setItem(
      REMEMBER_ME_KEY,
      rememberMe.value ? (values.username ?? '') : '',
    );
    emit('submit', values);
  }
}

/** 跳转到指定路径，用于验证码登录、忘记密码与注册三个入口。 */
function handleGo(path: string) {
  router.push(path);
}

onMounted(() => {
  if (localUsername) {
    formApi.setFieldValue('username', localUsername);
  }
});

defineExpose({
  /** 暴露内部表单 API，供上层主动取值、设值或触发表单校验。 */
  getFormApi: () => formApi,
});
</script>

<template>
  <div @keydown.enter.prevent="handleSubmit">
    <slot name="title">
      <Title>
        <slot name="title">
          {{ title || `${$t('authentication.welcomeBack')} 👋🏻` }}
        </slot>
        <template #desc>
          <span class="text-muted-foreground">
            <slot name="subTitle">
              {{ subTitle || $t('authentication.loginSubtitle') }}
            </slot>
          </span>
        </template>
      </Title>
    </slot>

    <Form />

    <div
      v-if="showRememberMe || showForgetPassword"
      class="mb-6 flex justify-between"
    >
      <div class="flex-center">
        <VbenCheckbox
          v-if="showRememberMe"
          v-model="rememberMe"
          name="rememberMe"
        >
          {{ $t('authentication.rememberMe') }}
        </VbenCheckbox>
      </div>

      <span
        v-if="showForgetPassword"
        class="vben-link text-sm font-normal"
        @click="handleGo(forgetPasswordPath)"
      >
        {{ $t('authentication.forgetPassword') }}
      </span>
    </div>
    <VbenButton
      :class="{
        'cursor-wait': loading,
      }"
      :loading="loading"
      aria-label="login"
      class="w-full"
      @click="handleSubmit"
    >
      {{ submitButtonText || $t('common.login') }}
    </VbenButton>
  </div>
</template>
