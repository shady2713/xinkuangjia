<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';
import type { Recordable } from '@vben/types';

import { computed, ref } from 'vue';

import { AuthenticationCodeLogin, Verification, z } from '@vben/common-ui';
import { isCaptchaEnable } from '@vben/hooks';
import { $t } from '@vben/locales';
import { logError } from '@vben/utils';

import { checkCaptcha, getCaptcha, sendSmsCode } from '#/api/core/auth';
import { useAuthStore } from '#/store';
import { showSuccessMessage } from '#/utils/feedback';

defineOptions({ name: 'CodeLogin' });

const authStore = useAuthStore();
const captchaEnable = isCaptchaEnable();

const loading = ref(false);
const CODE_LENGTH = 4;
const SMS_LOGIN_SCENE = 21;
const captchaType = 'blockPuzzle';

const loginRef = ref();
const verifyRef = ref();
/** 验证码成功回调签名。 */
type CaptchaResolve = (token: string) => void;
/** 验证码取消回调签名。 */
type CaptchaReject = (reason?: unknown) => void;
/** 待决图形验证码成功回调引用。 */
let pendingCaptchaResolver: CaptchaResolve | null = null;
/** 待决图形验证码取消回调引用。 */
let pendingCaptchaRejecter: CaptchaReject | null = null;

/**
 * 拉起图形验证码弹窗并等待用户通过核验。
 *
 * @returns 通过核验后的验证码票据；未开启验证码时返回 undefined
 */
function requestCaptchaVerification(): Promise<string | undefined> {
  if (!captchaEnable) {
    return Promise.resolve(undefined);
  }
  /**
   * 记录 Promise 控制器并展示图形验证码弹窗。
   *
   * @param resolve 成功回调
   * @param reject 取消回调
   */
  function openVerificationPopup(
    resolve: CaptchaResolve,
    reject: CaptchaReject,
  ) {
    pendingCaptchaResolver = resolve;
    pendingCaptchaRejecter = reject;
    verifyRef.value?.show();
  }
  return new Promise<string>(openVerificationPopup);
}

/** 图形验证码核验成功回调。 */
function handleVerifySuccess({
  captchaVerification,
}: {
  captchaVerification: string;
}) {
  pendingCaptchaResolver?.(captchaVerification);
  pendingCaptchaResolver = null;
  pendingCaptchaRejecter = null;
}

/** 用户关闭图形验证码弹窗时中断本次发码等待。 */
function handleVerifyClose() {
  pendingCaptchaRejecter?.(new Error('已取消验证码校验'));
  pendingCaptchaResolver = null;
  pendingCaptchaRejecter = null;
}

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
        /**
         * 生成验证码倒计时按钮文案。
         *
         * @param countdown 剩余秒数
         * @returns 按钮展示文本
         */
        createText: (countdown: number) => {
          return countdown > 0
            ? $t('authentication.sendText', [countdown])
            : $t('authentication.sendCode');
        },
        placeholder: $t('authentication.code'),
        /**
         * 校验手机号与图形验证码后请求发送登录短信验证码。
         *
         * @throws 表单未就绪或手机号格式不合法时抛出异常阻断倒计时
         */
        handleSendCode: async () => {
          loading.value = true;
          try {
            const formApi = loginRef.value?.getFormApi();
            if (!formApi) {
              throw new Error('表单未初始化');
            }
            await formApi.validateField('mobile');
            const isMobileValid = await formApi.isFieldValid('mobile');
            if (!isMobileValid) {
              throw new Error('请输入有效的手机号码');
            }
            const { mobile } = await formApi.getValues();
            const captchaVerification = await requestCaptchaVerification();
            await sendSmsCode({
              captchaVerification,
              mobile,
              scene: SMS_LOGIN_SCENE,
            });
            showSuccessMessage('验证码已提交发送');
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
 * 提交手机号与短信验证码执行登录。
 *
 * @param values 登录表单数据
 */
async function handleLogin(values: Recordable<any>) {
  try {
    await authStore.authLogin(
      'mobile',
      values as { code: string; mobile: string },
    );
  } catch (error) {
    logError('auth:code-login:submit', error);
  }
}
</script>

<template>
  <div>
    <AuthenticationCodeLogin
      ref="loginRef"
      :form-schema="formSchema"
      :loading="loading"
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
      @on-close="handleVerifyClose"
      @on-success="handleVerifySuccess"
    />
  </div>
</template>
