<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';

import { computed, h, ref } from 'vue';

import { AuthenticationRegister, Verification, z } from '@vben/common-ui';
import { isCaptchaEnable } from '@vben/hooks';
import { $t } from '@vben/locales';
import { logError } from '@vben/utils';

import {
  buildRequiredPasswordSchema,
  buildRequiredUsernameSchema,
} from '#/adapter/form';
import { checkCaptcha, getCaptcha } from '#/api/core/auth';
import { useAuthStore } from '#/store';

defineOptions({ name: 'Register' });

const loading = ref(false);

const authStore = useAuthStore();
const captchaEnable = isCaptchaEnable();

const registerRef = ref();
const verifyRef = ref();

const captchaType = 'blockPuzzle';

async function handleRegister(values: Record<string, unknown>) {
  if (captchaEnable) {
    verifyRef.value.show();
    return;
  }
  await authStore.authLogin('register', values);
}

/** 验证码通过后携带校验串完成注册 */
const handleVerifySuccess = async ({
  captchaVerification,
}: {
  captchaVerification: string;
}) => {
  try {
    await authStore.authLogin('register', {
      ...(await registerRef.value.getFormApi().getValues()),
      captchaVerification,
    });
  } catch (error) {
    logError('auth:register:verify', error);
  }
};

const formSchema = computed(
  /** 注册表单字段配置 */
  (): VbenFormSchema[] => {
    return [
      {
        component: 'VbenInput',
        componentProps: {
          placeholder: $t('authentication.usernameTip'),
        },
        fieldName: 'username',
        label: $t('authentication.username'),
        rules: buildRequiredUsernameSchema($t('authentication.username')),
      },
      {
        component: 'VbenInput',
        componentProps: {
          placeholder: $t('authentication.nicknameTip'),
        },
        fieldName: 'nickname',
        label: $t('authentication.nickname'),
        rules: z.string().min(1, { message: $t('authentication.nicknameTip') }),
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
         * 渲染密码强度提示插槽
         * @returns 密码强度文案插槽
         */
        renderComponentContent() {
          return {
            // 展示密码强度说明
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
           * 确认密码校验规则
           * @param values 当前表单值
           * @returns 与密码一致的校验规则
           */
          rules(values) {
            const { password } = values;
            return buildRequiredPasswordSchema(
              $t('authentication.confirmPassword'),
            ).refine(
              // 校验确认密码与密码一致
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
      {
        component: 'VbenCheckbox',
        fieldName: 'agreePolicy',
        // 渲染同意协议勾选框的说明文案
        renderComponentContent: () => ({
          // 勾选框默认插槽：协议与条款链接
          default: () =>
            h('span', [
              $t('authentication.agree'),
              h(
                'a',
                {
                  class: 'vben-link ml-1 ',
                  href: '',
                },
                `${$t('authentication.privacyPolicy')} & ${$t('authentication.terms')}`,
              ),
            ]),
        }),
        rules: z.boolean().refine(
          // 必须勾选同意协议
          (value) => !!value,
          {
            message: $t('authentication.agreeTip'),
          },
        ),
      },
    ];
  },
);
</script>

<template>
  <div>
    <AuthenticationRegister
      ref="registerRef"
      :form-schema="formSchema"
      :loading="loading"
      @submit="handleRegister"
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
