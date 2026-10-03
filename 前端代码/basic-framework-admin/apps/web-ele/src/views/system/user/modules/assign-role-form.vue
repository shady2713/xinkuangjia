<script lang="ts" setup>
/**
 * 用户角色分配弹窗：只提交勾选的角色编号集合。
 */
import type { ComponentType } from '#/adapter/component';
import type { SystemUserApi } from '#/api/system/user';

import { useVbenModal } from '@vben/common-ui';

import { ElMessage } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { assignUserRole, getUserRoleList } from '#/api/system/permission';
import { $t } from '#/locales';

import { useAssignRoleFormSchema } from '../data';

/** 分配角色表单值：用户编号与勾选的角色编号。 */
type AssignRoleForm = {
  id: number;
  roleIds: number[];
};

const emit = defineEmits(['success']);
const [Form, formApi] = useVbenForm<ComponentType, AssignRoleForm>({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    formItemClass: 'col-span-2',
    labelWidth: 80,
  },
  layout: 'horizontal',
  schema: useAssignRoleFormSchema(),
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  /**
   * 提交角色勾选结果：未勾选任何角色时直接返回，避免提交空集合覆盖已有分配。
   */
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    // 提交表单
    const values = await formApi.getValues();
    try {
      await assignUserRole({
        userId: values.id,
        roleIds: values.roleIds,
      });
      // 关闭并提示
      await modalApi.close();
      emit('success');
      ElMessage.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  /**
   * 打开弹窗时加载该用户已分配的角色；关闭时不做任何事，保留未提交的勾选。
   * @param isOpen 当前弹窗是否打开。
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      return;
    }
    // 加载数据
    const data = modalApi.getData<SystemUserApi.User>();
    if (!data || !data.id) {
      return;
    }
    modalApi.lock();
    try {
      const roleIds = await getUserRoleList(data.id);
      // 弹窗只回填用户编号，角色勾选状态由已授权角色列表设置。
      await formApi.setValues({ id: data.id, roleIds: roleIds ?? [] });
    } finally {
      modalApi.unlock();
    }
  },
});
</script>

<template>
  <Modal title="分配角色">
    <Form class="mx-4" />
  </Modal>
</template>
