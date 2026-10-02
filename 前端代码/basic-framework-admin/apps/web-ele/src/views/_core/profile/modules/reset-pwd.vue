<script setup lang="ts">
import type { Recordable } from '@vben/types';

import { $t } from '@vben/locales';
import { logError, md5 } from '@vben/utils';

import { ElMessage } from 'element-plus';

import { buildLoginPasswordSchema, buildRequiredPasswordSchema, useVbenForm } from '#/adapter/form';
import { updateUserPassword } from '#/api/system/user/profile';

const [Form, formApi] = useVbenForm({
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

async function handleSubmit(values: Recordable<any>) {
  try {
    formApi.setLoading(true);
    await updateUserPassword({
      oldPassword: md5(values.oldPassword),
      newPassword: md5(values.newPassword),
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