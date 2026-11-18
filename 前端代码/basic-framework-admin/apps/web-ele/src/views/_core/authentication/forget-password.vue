<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';
import type { Recordable } from '@vben/types';

import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { AuthenticationForgetPassword, Verification, z } from '@vben/common-ui';
import { isCaptchaEnable } from '@vben/hooks';
import { $t } from '@vben/locales';
import { logError } from '@vben/utils';

import {
  buildRequiredMobileSchema,
  buildRequiredPasswordSchema,
} from '#/adapter/form';
import {
  checkCaptcha,
  getCaptcha,
  sendSmsCode,
  smsResetPassword,
} from '#/api/core/auth';
import { showSuccessMessage } from '#/utils/feedback';
import { encryptPassword } from '#/utils/sm2';

defineOptions({ name: 'ForgetPassword' });

const router = useRouter();
const captchaEnable = isCaptchaEnable();

const loading = ref(false);
const CODE_LENGTH = 4;
const SMS_RESET_SCENE = 23;
const captchaType = 'blockPuzzle';
const forgetPasswordRef = ref();
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
 * 拉起图形验证码弹窗并等待用户完成核验。
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

/** 关闭图形验证码弹窗时终止发码等待。 */
function handleVerifyClose() {
  pendingCaptchaRejecter?.(new Error('已取消验证码校验'));
  pendingCaptchaResolver = null;
  pendingCaptchaRejecter = null;
}

/**
 * 构建忘记密码表单字段。
 *
 * @returns 手机号、验证码、新密码和确认密码字段
 */
function buildFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'VbenInput',
      componentProps: {
        placeholder: $t('authentication.mobile'),
      },
      fieldName: 'mobile',
      label: $t('authentication.mobile'),
      rules: buildRequiredMobileSchema($t('authentication.mobile')),
    },
    {
      component: 'VbenPinInput',
      componentProps: {
        codeLength: CODE_LENGTH,
        createText: (countdown: number) => {
          return countdown > 0
            ? $t('authentication.sendText', [countdown])
            : $t('authentication.sendCode');
        },
        placeholder: $t('authentication.code'),
        /**
         * 校验手机号与图形验证码后发送重置密码短信验证码。
         *
         * @throws 表单未就绪或手机号格式不合法时抛出异常阻断倒计时
         */
        handleSendCode: async () => {
          loading.value = true;
          try {
            const formApi = forgetPasswordRef.value?.getFormApi();
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
              scene: SMS_RESET_SCENE,
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
    {
      component: 'VbenInputPassword',
      componentProps: {
        passwordStrength: true,
        placeholder: $t('authentication.password'),
      },
      fieldName: 'password',
      label: $t('authentication.password'),
      renderComponentContent() {
        return {
          strengthText: () => $t('authentication.passwordStrength'),
        };
      },
      rules: buildRequiredPasswordSchema($t('authentication.password')),
    },
    {
      component: 'VbenInputPassword',
      componentProps: {
        placeholder: $t('authentication.confirmPassword'),
      },
      dependencies: {
        /**
         * 校验确认密码与新密码一致。
         *
         * @param values 当前表单值
         * @returns Zod 确认密码规则
         */
        rules(values) {
          const { password } = values;
          /**
           * 判断确认密码是否等于新密码。
           *
           * @param value 确认密码
           * @returns 一致返回 true
           */
          function isSamePassword(value: string) {
            return value === password;
          }
          return buildRequiredPasswordSchema(
            $t('authentication.confirmPassword'),
          ).refine(isSamePassword, {
            message: $t('authentication.confirmPasswordTip'),
          });
        },
        triggerFields: ['password'],
      },
      fieldName: 'confirmPassword',
      label: $t('authentication.confirmPassword'),
    },
  ];
}

const formSchema = computed(buildFormSchema);

/**
 * 加密新密码后提交短信重置密码请求。
 *
 * @param values 表单值
 * @returns 提交完成的 Promise
 */
async function handleSubmit(values: Recordable<any>) {
  loading.value = true;
  try {
    const { mobile, code, password } = values;
    await smsResetPassword({
      mobile,
      code,
      password: await encryptPassword(password),
    });
    showSuccessMessage($t('authentication.resetPasswordSuccess'));
    await router.push('/');
  } catch (error) {
    logError('auth:forget-password:submit', error);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <AuthenticationForgetPassword
      ref="forgetPasswordRef"
      :form-schema="formSchema"
      :loading="loading"
      @submit="handleSubmit"
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
