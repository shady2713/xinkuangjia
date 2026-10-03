<script lang="ts" setup>
/** 手机登录表单：提交前收窄实际字段，并由认证 Store 维护身份生命周期。 */
import type { VbenFormSchema } from '@vben/common-ui';

import { computed, ref } from 'vue';

import { AuthenticationCodeLogin, z } from '@vben/common-ui';
import { $t } from '@vben/locales';
import { isRecord } from '@vben/request';
import { logError } from '@vben/utils';

import { sendSmsCode } from '#/api';
import { useAuthStore } from '#/store';
import { showSuccessMessage } from '#/utils/feedback';

defineOptions({ name: 'CodeLogin' });

const authStore = useAuthStore();

const loading = ref(false);
const CODE_LENGTH = 4;

const loginRef = ref<InstanceType<typeof AuthenticationCodeLogin>>();

const formSchema = computed(
  /** 根据当前语言创建手机号与验证码输入规则。 */ (): VbenFormSchema[] => {
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
          .refine(
            /** 手机号由表单边界限定为十一位数字。 */ (v) => /^\d{11}$/.test(v),
            {
              message: $t('authentication.mobileErrortip'),
            },
          ),
      },
      {
        component: 'VbenPinInput',
        componentProps: {
          codeLength: CODE_LENGTH,
          /** 根据剩余时间展示验证码发送按钮文案。 */
          createText: (countdown: number) => {
            const text =
              countdown > 0
                ? $t('authentication.sendText', [countdown])
                : $t('authentication.sendCode');
            return text;
          },
          placeholder: $t('authentication.code'),
          /** 校验真实手机号字段后请求短信，并维护发送状态。
           * @throws {Error} 表单未挂载、手机号校验失败或接口发送失败。
           */
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
              const values: unknown = await formApi.getValues();
              if (!isRecord(values) || typeof values.mobile !== 'string')
                throw new TypeError('手机号字段无效');
              const mobile = values.mobile;
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
  },
);
/**
 * 异步处理登录操作
 * Asynchronously handle the login process
 * @param values 登录表单数据
 */
async function handleLogin(values: Record<string, unknown>) {
  try {
    if (typeof values.mobile !== 'string' || typeof values.code !== 'string')
      throw new TypeError('手机号或验证码字段无效');
    await authStore.authLogin('mobile', {
      mobile: values.mobile,
      code: values.code,
    });
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
