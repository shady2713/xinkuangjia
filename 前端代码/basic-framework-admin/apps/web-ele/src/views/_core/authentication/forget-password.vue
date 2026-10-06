<script lang="ts" setup>
/**
 * 忘记密码页：收集手机号、短信验证码与新密码，提交后重置并跳回首页。
 *
 * 短信下发固定带 scene=23，密码在提交前做 MD5，失败只记日志保留表单；
 * 页面负责表单编排与跳转，鉴权令牌与登录态由认证状态模块处理。
 */
import type { VbenFormSchema } from '@vben/common-ui';
import type { Recordable } from '@vben/types';

import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { AuthenticationForgetPassword, z } from '@vben/common-ui';
import { $t } from '@vben/locales';
import { logError, md5 } from '@vben/utils';

import {
  buildRequiredMobileSchema,
  buildRequiredPasswordSchema,
} from '#/adapter/form';
import { sendSmsCode, smsResetPassword } from '#/api';
import { showSuccessMessage } from '#/utils/feedback';

defineOptions({ name: 'ForgetPassword' });

const router = useRouter();

const loading = ref(false);
const CODE_LENGTH = 4;
const forgetPasswordRef = ref();

const formSchema = computed(
  /**
   * 构建忘记密码表单：手机号、短信验证码、新密码与确认密码。
   * 依赖 schema 里的校验规则完成本地校验，只有全部通过才会调用重置密码接口。
   * @returns 表单 schema 定义。
   */
  (): VbenFormSchema[] => {
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
          /**
           * 倒计时期间展示剩余秒数，归零后恢复为"发送验证码"。
           * @param countdown 距离可重新发送还剩的秒数。
           * @returns 发送按钮上的文案。
           */
          createText: (countdown: number) => {
            return countdown > 0
              ? $t('authentication.sendText', [countdown])
              : $t('authentication.sendCode');
          },
          placeholder: $t('authentication.code'),
          /**
           * 发送短信验证码。
           * 先本地校验手机号，通过后才带上 scene=23（忘记密码场景）请求下发。
           * @throws 表单实例尚未就绪，或手机号校验不通过时抛出，调用方据此提示用户。
           */
          handleSendCode: async () => {
            loading.value = true;
            try {
              const formApi = forgetPasswordRef.value?.getFormApi();
              if (!formApi) {
                throw new Error('Form is not ready');
              }
              await formApi.validateField('mobile');
              const isMobileValid = await formApi.isFieldValid('mobile');
              if (!isMobileValid) {
                throw new Error('Invalid mobile');
              }
              const { mobile } = await formApi.getValues();
              const scene = 23;
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
      {
        component: 'VbenInputPassword',
        componentProps: {
          passwordStrength: true,
          placeholder: $t('authentication.password'),
        },
        fieldName: 'password',
        label: $t('authentication.password'),
        /**
         * 向密码组件注入强度提示文案，由组件在输入时实时展示。
         * @returns 组件自定义内容插槽需要的键值对。
         */
        renderComponentContent() {
          return {
            /**
             * 强度提示文案，由密码组件在每次输入后重新求值。
             * @returns 当前语言下的强度说明文案。
             */
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
           * 确认密码的校验依赖已输入的新密码，随 triggerFields 变化重新计算。
           * @param values 当前表单值，其中 password 是新密码。
           * @returns 带"两次输入一致"细化规则的校验链。
           */
          rules(values) {
            const { password } = values;
            return buildRequiredPasswordSchema(
              $t('authentication.confirmPassword'),
            ).refine(
              /**
               * 比对两次输入是否一致，不一致时提示用户重新确认。
               * @param value 本次输入的确认密码。
               * @returns 与新密码一致时为 true。
               */
              (value) => value === password,
              {
                message: $t('authentication.confirmPasswordTip'),
              },
            );
          },
          triggerFields: ['password'],
        },
        fieldName: 'confirmPassword',
        label: $t('authentication.confirmPassword'),
      },
    ];
  },
);

/**
 * 提交忘记密码表单。
 * 密码在提交前做 MD5，接口失败时只记录日志并保留表单内容让用户重试，
 * 成功后跳回首页。
 * @param values 表单收集到的手机号、验证码与新密码。
 */
async function handleSubmit(values: Recordable<unknown>) {
  loading.value = true;
  try {
    // 表单只收集手机号、验证码和新密码三项，取值前先还原成真实结构。
    const { mobile, code, password } = values as {
      code: string;
      mobile: string;
      password: string;
    };
    await smsResetPassword({ mobile, code, password: md5(password) });
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
  <AuthenticationForgetPassword
    ref="forgetPasswordRef"
    :form-schema="formSchema"
    :loading="loading"
    @submit="handleSubmit"
  />
</template>
