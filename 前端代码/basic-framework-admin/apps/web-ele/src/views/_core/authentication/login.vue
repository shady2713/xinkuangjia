<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';

import { computed, ref } from 'vue';

import { AuthenticationLogin, Verification } from '@vben/common-ui';
import { getDefaultLoginCredentials, isCaptchaEnable } from '@vben/hooks';
import { $t } from '@vben/locales';
import { logError } from '@vben/utils';

import {
  buildLoginPasswordSchema,
  buildRequiredUsernameSchema,
} from '#/adapter/form';
import { checkCaptcha, getCaptcha } from '#/api/core/auth';
import { useAuthStore } from '#/store';

defineOptions({ name: 'Login' });

const authStore = useAuthStore();
const captchaEnable = isCaptchaEnable();
const defaultCredentials = getDefaultLoginCredentials(
  import.meta.env,
  import.meta.env.PROD,
);

const loginRef = ref();
const verifyRef = ref();

const captchaType = 'blockPuzzle';

/** 提交登录表单；启用图形验证码时先拉起行为验证码弹窗。 */
async function handleLogin(values: Record<string, unknown>) {
  if (captchaEnable) {
    verifyRef.value.show();
    return;
  }
  await authStore.authLogin('username', values);
}

/** 验证码通过后携带校验串完成登录。 */
async function handleVerifySuccess({
  captchaVerification,
}: {
  captchaVerification: string;
}) {
  try {
    await authStore.authLogin('username', {
      ...(await loginRef.value.getFormApi().getValues()),
      captchaVerification,
    });
  } catch (error) {
    logError('auth:login:verify', error);
  }
}

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'VbenInput',
      componentProps: {
        placeholder: $t('authentication.usernameTip'),
      },
      fieldName: 'username',
      label: $t('authentication.username'),
      rules: buildRequiredUsernameSchema($t('authentication.username')).default(
        defaultCredentials.username,
      ),
    },
    {
      component: 'VbenInputPassword',
      componentProps: {
        placeholder: $t('authentication.passwordTip'),
      },
      fieldName: 'password',
      label: $t('authentication.password'),
      rules: buildLoginPasswordSchema($t('authentication.password')).default(
        defaultCredentials.password,
      ),
    },
  ];
});
</script>

<template>
  <div>
    <AuthenticationLogin
      ref="loginRef"
      :form-schema="formSchema"
      :loading="authStore.loginLoading"
      :show-register="false"
      :show-third-party-login="false"
      @submit="handleLogin"
    />
    <Verification
      v-if="captchaEnable"
      ref="verifyRef"
      :captcha-type="captchaType"
      :check-captcha-api="checkCaptcha"
      :get-captcha-api="getCaptcha"
      :img-size="{ width: '400px', height: '200px' }"
      mode="pop"
      @on-success="handleVerifySuccess"
    />
  </div>
</template>
