<script setup lang="ts">
/**
 * 个人中心的“基础信息”表单：编辑昵称、手机号与性别，保存后通知外层刷新个人资料。
 */
import type { ComponentType } from '#/adapter/component';
import type { SystemUserProfileApi } from '#/api/system/user/profile';

import { watch } from 'vue';

import { DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';
import { $t } from '@vben/locales';
import { logError } from '@vben/utils';

import { ElMessage } from 'element-plus';

import {
  buildOptionalEmailSchema,
  buildOptionalMobileSchema,
  useVbenForm,
  z,
} from '#/adapter/form';
import { updateUserProfile } from '#/api/system/user/profile';

const props = defineProps<{
  profile?: SystemUserProfileApi.UserProfileRespVO;
}>();
const emit = defineEmits<{
  /**
   * 基础信息保存成功后通知外层刷新个人资料。
   * @param e 事件名，固定为 success。
   */
  (e: 'success'): void;
}>();

/** 表单值即“更新个人信息”请求体：字段与后端 UpdateProfileReqVO 一致。 */
const [Form, formApi] = useVbenForm<
  ComponentType,
  SystemUserProfileApi.UpdateProfileReqVO
>({
  commonConfig: {
    labelWidth: 70,
  },
  schema: [
    {
      label: '用户昵称',
      fieldName: 'nickname',
      component: 'Input',
      componentProps: {
        placeholder: '请输入用户昵称',
      },
      rules: 'required',
    },
    {
      label: '用户手机',
      fieldName: 'mobile',
      component: 'Input',
      componentProps: {
        placeholder: '请输入用户手机',
      },
      rules: buildOptionalMobileSchema('手机号'),
    },
    {
      label: '用户邮箱',
      fieldName: 'email',
      component: 'Input',
      componentProps: {
        placeholder: '请输入用户邮箱',
      },
      rules: buildOptionalEmailSchema('邮箱'),
    },
    {
      label: '用户性别',
      fieldName: 'sex',
      component: 'RadioGroup',
      componentProps: {
        options: getDictOptions(DICT_TYPE.SYSTEM_USER_SEX, 'number'),
      },
      rules: z.number(),
    },
  ],
  resetButtonOptions: {
    show: false,
  },
  submitButtonOptions: {
    content: '更新信息',
  },
  handleSubmit,
});

/**
 * 保存基础信息。
 * @param values 已通过校验的表单值，形状与后端请求体一致。
 * @returns 提交完成后兑现；失败时由请求层抛出，外层负责提示。
 */
async function handleSubmit(values: SystemUserProfileApi.UpdateProfileReqVO) {
  try {
    formApi.setLoading(true);
    await updateUserProfile(values);
    emit('success');
    ElMessage.success($t('ui.actionMessage.operationSuccess'));
  } catch (error) {
    logError('profile:base-info:submit', error);
  } finally {
    formApi.setLoading(false);
  }
}

watch(
  () => props.profile,
  /**
   * 外部资料变化时回填表单，资料未就绪时保持表单原值。
   * @param newProfile 最新的个人资料；首次渲染时为 undefined。
   */
  (newProfile) => {
    if (newProfile) {
      formApi.setValues(newProfile);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="mt-4 md:w-full lg:w-1/2 2xl:w-2/5">
    <Form />
  </div>
</template>
