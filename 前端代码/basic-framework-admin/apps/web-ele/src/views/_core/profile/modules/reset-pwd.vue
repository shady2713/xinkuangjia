<script setup lang="ts">
/** 个人改密成功后结束全部旧会话；迟到响应由认证 Store 校验身份。 */
import type { ComponentType } from '#/adapter/component';
import type { SystemUserProfileApi } from '#/api/system/user/profile';

import { $t } from '@vben/locales';
import { logError } from '@vben/utils';

import { ElMessage } from 'element-plus';

import {
  buildLoginPasswordSchema,
  buildRequiredPasswordSchema,
  useVbenForm,
} from '#/adapter/form';
import { useAuthStore } from '#/store';

const authStore = useAuthStore();

const [Form, formApi] = useVbenForm<
  ComponentType,
  SystemUserProfileApi.UpdatePasswordReqVO
>({
  commonConfig: {
    labelWidth: 70,
  },
  schema: [
    {
      component: 'VbenInputPassword',
      componentProps: {
        placeholder: $t('authentication.password'),
      },
      fieldName: 'oldPassword',
      label: '旧密码',
      rules: buildLoginPasswordSchema('旧密码'),
    },
    {
      component: 'VbenInputPassword',
      componentProps: {
        passwordStrength: true,
        placeholder: '请输入新密码',
      },
      dependencies: {
        rules(values) {
          return buildRequiredPasswordSchema('新密码').refine(
            (value) => value !== values.oldPassword,
            '新旧密码不能相同',
          );
        },
        triggerFields: ['newPassword', 'oldPassword'],
      },
      fieldName: 'newPassword',
      label: '新密码',
      rules: 'passwordRequired',
    },
    {
      component: 'VbenInputPassword',
      componentProps: {
        passwordStrength: true,
        placeholder: $t('authentication.confirmPassword'),
      },
      dependencies: {
        rules(values) {
          return buildRequiredPasswordSchema('确认密码').refine(
            (value) => value === values.newPassword,
            '新密码和确认密码不一致',
          );
        },
        triggerFields: ['newPassword', 'confirmPassword'],
      },
      fieldName: 'confirmPassword',
      label: '确认密码',
      rules: 'passwordRequired',
    },
  ],
  resetButtonOptions: {
    show: false,
  },
  submitButtonOptions: {
    content: '修改密码',
  },
  handleSubmit,
});

/** 提交表单并退出修改密码时的身份，失败时保留可重试的表单。
 * @param values 已通过密码一致性校验的表单值。
 */
async function handleSubmit(values: SystemUserProfileApi.UpdatePasswordReqVO) {
  try {
    formApi.setLoading(true);
    await authStore.changePassword({
      oldPassword: values.oldPassword ?? '',
      newPassword: values.newPassword ?? '',
    });
    ElMessage.success($t('ui.actionMessage.operationSuccess'));
  } catch (error) {
    logError('profile:reset-password:submit', error);
  } finally {
    formApi.setLoading(false);
  }
}
</script>

<template>
  <div class="mt-4 md:w-full lg:w-1/2 2xl:w-2/5">
    <Form />
  </div>
</template>
