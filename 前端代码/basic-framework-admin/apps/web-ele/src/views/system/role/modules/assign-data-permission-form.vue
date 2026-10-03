<script lang="ts" setup>
/**
 * 角色数据权限分配弹窗：按数据范围类型决定提交部门集合还是全部数据。
 */
import type { ComponentType } from '#/adapter/component';
import type { SystemDeptApi } from '#/api/system/dept';
import type { SystemRoleApi } from '#/api/system/role';

import { ref } from 'vue';

import { Tree, useVbenModal } from '@vben/common-ui';
import { SystemDataScopeEnum } from '@vben/constants';
import { handleTree } from '@vben/utils';

import { ElCheckbox, ElMessage } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { getDeptList } from '#/api/system/dept';
import { assignRoleDataScope } from '#/api/system/permission';
import { getRole } from '#/api/system/role';
import { $t } from '#/locales';

import { useAssignDataPermissionFormSchema } from '../data';

/** 数据权限表单值：角色编号、数据范围类型与自定义部门编号。 */
type AssignDataPermissionForm = {
  dataScope: number;
  dataScopeDeptIds: number[];
  id: number;
};

const emit = defineEmits(['success']);

const deptTree = ref<SystemDeptApi.Dept[]>([]); // 部门树
const deptLoading = ref(false); // 加载部门列表
const isAllSelected = ref(false); // 全选状态
const isExpanded = ref(false); // 展开状态
const isCheckStrictly = ref(true); // 父子联动状态
const expandedKeys = ref<number[]>([]); // 展开的节点

type TreeNodeLike = {
  children?: TreeNodeLike[];
  id?: number;
};

const [Form, formApi] = useVbenForm<ComponentType, AssignDataPermissionForm>({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    formItemClass: 'col-span-2',
    labelWidth: 80,
  },
  layout: 'horizontal',
  schema: useAssignDataPermissionFormSchema(),
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  /**
   * 提交数据范围设置：仅在自定义范围下提交勾选的部门编号，其余类型提交空集合表示全部数据。
   */
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    const data = await formApi.getValues();
    try {
      await assignRoleDataScope({
        roleId: data.id,
        dataScope: data.dataScope,
        // 非自定义范围时后端不按部门过滤，这里保持空数组而不是 undefined。
        dataScopeDeptIds:
          data.dataScope === SystemDataScopeEnum.DEPT_CUSTOM
            ? data.dataScopeDeptIds
            : [],
      });
      await modalApi.close();
      emit('success');
      ElMessage.success($t('ui.actionMessage.operationSuccess'));
    } finally {
      modalApi.unlock();
    }
  },
  /**
   * 打开弹窗时按目标角色回填数据范围；关闭时不做任何事，保留未提交的改动。
   * @param isOpen 当前弹窗是否打开。
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      return;
    }
    const data = modalApi.getData<SystemRoleApi.Role>();
    if (!data || !data.id) {
      return;
    }
    modalApi.lock();
    try {
      // 加载部门列表
      await loadDeptTree();
      // 设置表单值，一定要在加载树之后；只回填本表单实际使用的字段。
      const role = await getRole(data.id);
      if (!role) {
        return;
      }
      await formApi.setValues({
        dataScope: role.dataScope,
        dataScopeDeptIds: role.dataScopeDeptIds ?? [],
        // 角色编号在弹窗打开时已经校验过，直接沿用该编号。
        id: data.id,
      });
    } finally {
      modalApi.unlock();
    }
  },
});

/** 加载部门树 */
async function loadDeptTree() {
  deptLoading.value = true;
  try {
    const data = await getDeptList();
    deptTree.value = handleTree(data) as SystemDeptApi.Dept[];
  } finally {
    deptLoading.value = false;
  }
}

/** 全选/全不选 */
function handleSelectAll() {
  isAllSelected.value = !isAllSelected.value;
  if (isAllSelected.value) {
    const allIds = getAllNodeIds(deptTree.value);
    formApi.setFieldValue('dataScopeDeptIds', allIds);
  } else {
    formApi.setFieldValue('dataScopeDeptIds', []);
  }
}

/** 展开/折叠所有节点 */
function handleExpandAll() {
  isExpanded.value = !isExpanded.value;
  expandedKeys.value = isExpanded.value ? getAllNodeIds(deptTree.value) : [];
}

/** 切换父子联动 */
function handleCheckStrictly() {
  isCheckStrictly.value = !isCheckStrictly.value;
}

/**
 * 递归收集部门树中所有可勾选的节点编号。
 * @param nodes 当前层的部门节点。
 * @param ids 收集结果的累加数组，递归时复用同一个引用。
 * @returns 收集到的全部节点编号。
 */
function getAllNodeIds(nodes: TreeNodeLike[], ids: number[] = []): number[] {
  nodes.forEach(
    /**
     * 处理单个节点：有编号则收集，并继续下钻子节点。
     * @param node 当前正在处理的部门节点。
     */
    (node) => {
      if (typeof node.id === 'number') {
        ids.push(node.id);
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        getAllNodeIds(node.children, ids);
      }
    },
  );
  return ids;
}
</script>

<template>
  <Modal title="数据权限" class="w-2/5">
    <Form class="mx-4">
      <template #dataScopeDeptIds="slotProps">
        <Tree
          v-loading="deptLoading"
          :tree-data="deptTree"
          multiple
          bordered
          :default-expanded-keys="expandedKeys"
          v-bind="slotProps"
          :check-strictly="!isCheckStrictly"
          value-field="id"
          label-field="name"
        />
      </template>
    </Form>
    <template #prepend-footer>
      <div class="flex flex-auto items-center">
        <ElCheckbox :model-value="isAllSelected" @change="handleSelectAll">
          全选
        </ElCheckbox>
        <ElCheckbox :model-value="isExpanded" @change="handleExpandAll">
          全部展开
        </ElCheckbox>
        <ElCheckbox
          :model-value="isCheckStrictly"
          @change="handleCheckStrictly"
        >
          父子联动
        </ElCheckbox>
      </div>
    </template>
  </Modal>
</template>
