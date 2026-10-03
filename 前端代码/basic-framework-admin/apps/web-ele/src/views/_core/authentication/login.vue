<script lang="ts" setup>
/** 管理平台登录入口；默认不展示开放注册，账号由受控管理流程创建。 */
import type { VbenFormSchema } from '@vben/common-ui';

import type { AuthApi } from '#/api/core/auth';

import { computed, onBeforeUnmount, ref } from 'vue';

import { AuthenticationLogin, Verification } from '@vben/common-ui';
import { isCaptchaEnable } from '@vben/hooks';
import { $t } from '@vben/locales';
import { isRecord } from '@vben/request';
import { logError } from '@vben/utils';

import {
  buildLoginPasswordSchema,
  buildRequiredUsernameSchema,
} from '#/adapter/form';
import { checkCaptcha, getCaptcha } from '#/api/core/auth';
import { useAuthStore } from '#/store';
import { getSessionEpoch, isCurrentSession } from '#/utils/auth-session';

defineOptions({ name: 'Login' });

const authStore = useAuthStore();
const captchaEnable = isCaptchaEnable();

const loginRef = ref<InstanceType<typeof AuthenticationLogin>>();
const verifyRef = ref<InstanceType<typeof Verification>>();

const captchaType = 'blockPuzzle';
let pendingLoginEpoch: number | undefined;
let active = true;

/** 从表单实际结果提取登录字段，拒绝缺失或非文本凭据。
 * @param values 表单组件返回的未知数据。
 * @returns 可提交的账号密码，不透传额外表单字段。
 * @throws {TypeError} 账号或密码缺失、为空或类型错误。
 */
function loginCredentials(values: unknown): AuthApi.LoginParams {
  if (
    !isRecord(values) ||
    typeof values.username !== 'string' ||
    !values.username ||
    typeof values.password !== 'string' ||
    !values.password
  ) {
    throw new TypeError('账号或密码字段无效');
  }
  return { username: values.username, password: values.password };
}

/** 开始当前页面的登录尝试，验证码回调必须仍属于发起时的身份。
 * @param values 已通过表单校验的登录数据。
 */
async function handleLogin(values: Record<string, unknown>) {
  try {
    const credentials = loginCredentials(values);
    pendingLoginEpoch = getSessionEpoch();
    if (captchaEnable) {
      verifyRef.value?.show();
      return;
    }
    await authStore.authLogin('username', credentials);
  } catch (error) {
    logError('auth:login:submit', error);
  }
}

/** 验证码完成后读取表单，只允许当前页面及原身份继续发起登录。
 * @param verification 服务器返回的验证码校验凭证。
 */
async function handleVerifySuccess(verification: unknown) {
  const epoch = pendingLoginEpoch;
  if (epoch === undefined || !active || !isCurrentSession(epoch)) return;
  try {
    if (
      !isRecord(verification) ||
      typeof verification.captchaVerification !== 'string' ||
      !verification.captchaVerification
    ) {
      throw new TypeError('验证码凭证无效');
    }
    const values: unknown = await loginRef.value?.getFormApi().getValues();
    if (!active || !isCurrentSession(epoch)) return;
    await authStore.authLogin('username', {
      ...loginCredentials(values),
      captchaVerification: verification.captchaVerification,
    });
  } catch (error) {
    if (active && isCurrentSession(epoch)) logError('auth:login:verify', error);
  }
}

onBeforeUnmount(
  /** 页面退出后，旧验证码回调不能开始另一轮登录。 */ () => {
    active = false;
    pendingLoginEpoch = undefined;
  },
);

const formSchema = computed(
  /** 根据当前语言生成账号密码校验与展示规则。 */ (): VbenFormSchema[] => {
    return [
      {
        component: 'VbenInput',
        componentProps: {
          placeholder: $t('authentication.usernameTip'),
        },
        fieldName: 'username',
        label: $t('authentication.username'),
        rules: buildRequiredUsernameSchema(
          $t('authentication.username'),
        ).default(import.meta.env.VITE_APP_DEFAULT_USERNAME),
      },
      {
        component: 'VbenInputPassword',
        componentProps: {
          placeholder: $t('authentication.passwordTip'),
        },
        fieldName: 'password',
        label: $t('authentication.password'),
        rules: buildLoginPasswordSchema($t('authentication.password')).default(
          import.meta.env.VITE_APP_DEFAULT_PASSWORD,
        ),
      },
    ];
  },
);
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
      ref="verifyRef"
      v-if="captchaEnable"
      :captcha-type="captchaType"
      :check-captcha-api="checkCaptcha"
      :get-captcha-api="getCaptcha"
      :img-size="{ width: '400px', height: '200px' }"
      mode="pop"
      @on-success="handleVerifySuccess"
    />
  </div>
</template>
