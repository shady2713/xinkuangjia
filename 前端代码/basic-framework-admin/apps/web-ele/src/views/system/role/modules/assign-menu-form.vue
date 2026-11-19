<script lang="ts" setup>
/** 角色菜单与按钮权限分配弹窗组件。 */
import type { Recordable } from '@vben/types';

import type { SystemMenuApi } from '#/api/system/menu';
import type { SystemRoleApi } from '#/api/system/role';

import { nextTick, ref } from 'vue';

import { Tree, useVbenModal } from '@vben/common-ui';
import { SystemMenuTypeEnum } from '@vben/constants';
import { handleTree } from '@vben/utils';

import { ElCheckbox, ElMessage } from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { getSimpleMenusList } from '#/api/system/menu';
import { assignRoleMenu, getRoleMenuList } from '#/api/system/permission';
import { $t } from '#/locales';

import { useAssignMenuFormSchema } from '../data';

const emit = defineEmits(['success']);

const menuTree = ref<SystemMenuApi.Menu[]>([]); // 菜单树
const menuLoading = ref(false); // 加载菜单列表
const isAllSelected = ref(false); // 全选状态
const isExpanded = ref(false); // 展开状态
const expandedKeys = ref<(number | string)[]>([]); // 展开的节点

type TreeNodeLike = {
  children?: TreeNodeLike[];
  id?: number | string;
};

const [Form, formApi] = useVbenForm({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    formItemClass: 'col-span-2',
    labelWidth: 80,
  },
  layout: 'horizontal',
  schema: useAssignMenuFormSchema(),
  showDefaultActions: false,
});

const [Modal, modalApi] = useVbenModal({
  /** 校验表单并保存角色菜单权限分配，失败时仍释放弹窗锁。 */
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    try {
      // 提交表单
      const data = await formApi.getValues();
      await assignRoleMenu({
        roleId: data.id,
        menuIds: data.menuIds,
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
   * 弹窗打开时加载菜单树与角色已分配菜单集合。
   *
   * @param isOpen 弹窗是否处于打开状态
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      return;
    }
    // 加载菜单列表
    await loadMenuTree();
    const data = modalApi.getData<SystemRoleApi.Role>();
    if (!data || !data.id) {
      return;
    }
    modalApi.lock();
    try {
      // 加载角色菜单
      const menuIds = await getRoleMenuList(data.id);
      await formApi.setFieldValue('menuIds', menuIds);

      await formApi.setValues(data);
    } finally {
      await nextTick(); // 菜单过多，渲染较慢，需要等下一次事件循环
      modalApi.unlock();
    }
  },
});

/** 加载菜单树 */
async function loadMenuTree() {
  menuLoading.value = true;
  try {
    const data = await getSimpleMenusList();
    menuTree.value = handleTree(data) as SystemMenuApi.Menu[];
  } finally {
    menuLoading.value = false;
  }
}

/** 全选/全不选 */
function handleSelectAll() {
  isAllSelected.value = !isAllSelected.value;
  if (isAllSelected.value) {
    const allIds = getAllNodeIds(menuTree.value);
    formApi.setFieldValue('menuIds', allIds);
  } else {
    formApi.setFieldValue('menuIds', []);
  }
}

/** 展开/折叠所有节点 */
function handleExpandAll() {
  isExpanded.value = !isExpanded.value;
  expandedKeys.value = isExpanded.value ? getAllNodeIds(menuTree.value) : [];
}

/** 递归获取所有节点 ID */
function getAllNodeIds(
  nodes: TreeNodeLike[],
  ids: (number | string)[] = [],
): (number | string)[] {
  nodes.forEach(
    /**
     * 收集单个菜单节点及其子节点的编号。
     *
     * @param node 当前遍历到的菜单树节点
     */
    (node) => {
      if (typeof node.id === 'number' || typeof node.id === 'string') {
        ids.push(node.id);
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        getAllNodeIds(node.children, ids);
      }
    },
  );
  return ids;
}

/**
 * 为按钮级权限节点计算行内排列样式类。
 *
 * @param node 树节点渲染上下文
 * @returns 样式类名列表字符串
 */
function getNodeClass(node: Recordable<any>) {
  const classes: string[] = [];
  if (node.value?.type === SystemMenuTypeEnum.BUTTON) {
    classes.push('inline-flex');
    if (node.index % 3 >= 1) {
      classes.push('!pl-0');
    }
  }

  return classes.join(' ');
}
</script>

<template>
  <Modal title="菜单权限" class="w-2/5">
    <Form class="mx-4">
      <template #menuIds="slotProps">
        <Tree
          v-loading="menuLoading"
          :tree-data="menuTree"
          multiple
          bordered
          :default-expanded-keys="expandedKeys"
          :get-node-class="getNodeClass"
          v-bind="slotProps"
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
      </div>
    </template>
  </Modal>
</template>
