<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';
import type { Recordable } from '@vben/types';

import { computed, ref } from 'vue';

import { AuthenticationCodeLogin, z } from '@vben/common-ui';
import { $t } from '@vben/locales';
import { logError } from '@vben/utils';


import { sendSmsCode } from '#/api';
import { useAuthStore } from '#/store';
import { showSuccessMessage } from '#/utils/feedback';

defineOptions({ name: 'CodeLogin' });

const authStore = useAuthStore();

const loading = ref(false);
const CODE_LENGTH = 4;

const loginRef = ref();

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'VbenInput',
      componentProps: {
        placeholder: $t('authentication.mobile'),
      },
      fieldName: 'mobile',
      label: $t('authentication.mobile'),
      rules: z
        .string()
        .min(1, { message: $t('authentication.mobileTip') })
        .refine((v) => /^\d{11}$/.test(v), {
          message: $t('authentication.mobileErrortip'),
        }),
    },
    {
      component: 'VbenPinInput',
      componentProps: {
        codeLength: CODE_LENGTH,
        createText: (countdown: number) => {
          const text =
            countdown > 0
              ? $t('authentication.sendText', [countdown])
              : $t('authentication.sendCode');
          return text;
        },
        placeholder: $t('authentication.code'),
        handleSendCode: async () => {
          loading.value = true;
          try {
            const formApi = loginRef.value?.getFormApi();
            if (!formApi) {
              throw new Error('表单未准备好');
            }
            // 验证手机号
            await formApi.validateField('mobile');
            const isMobileValid = await formApi.isFieldValid('mobile');
            if (!isMobileValid) {
              throw new Error('请输入有效的手机号码');
            }

            // 发送验证码
            const { mobile } = await formApi.getValues();
            const scene = 21; // 场景：短信验证码登录
            await sendSmsCode({ mobile, scene });
            showSuccessMessage('验证码发送成功');
          } finally {
            loading.value = false;
          }
        },
      },
      fieldName: 'code',
      label: $t('authentication.code'),
      rules: z.string().length(CODE_LENGTH, {
        message: $t('authentication.codeTip', [CODE_LENGTH]),
      }),
    },
  ];
});
/**
 * 异步处理登录操作
 * Asynchronously handle the login process
 * @param values 登录表单数据
 */
async function handleLogin(values: Recordable<any>) {
  try {
    await authStore.authLogin('mobile', values);
  } catch (error) {
    logError('auth:code-login:submit', error);
  }
}
</script>

<template>
  <AuthenticationCodeLogin
    ref="loginRef"
    :form-schema="formSchema"
    :loading="loading"
    @submit="handleLogin"
  />
</template>




