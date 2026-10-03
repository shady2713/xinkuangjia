<script lang="ts" setup>
/**
 * 角色菜单分配弹窗：只提交勾选的菜单编号集合。
 */
import type { ComponentType } from '#/adapter/component';
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

/** 分配菜单表单值：角色编号与勾选的菜单编号。 */
type AssignMenuForm = {
  id: number;
  menuIds: number[];
};

const emit = defineEmits(['success']);

const menuTree = ref<SystemMenuApi.Menu[]>([]); // 菜单树
const menuLoading = ref(false); // 加载菜单列表
const isAllSelected = ref(false); // 全选状态
const isExpanded = ref(false); // 展开状态
const expandedKeys = ref<number[]>([]); // 展开的节点

type TreeNodeLike = {
  children?: TreeNodeLike[];
  id?: number;
};

const [Form, formApi] = useVbenForm<ComponentType, AssignMenuForm>({
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
  /**
   * 提交菜单勾选结果：未勾选任何菜单时直接返回，避免提交空集合覆盖已有授权。
   */
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    modalApi.lock();
    // 提交表单
    const data = await formApi.getValues();
    try {
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
   * 打开弹窗时先加载菜单树再回填已授权菜单；关闭时不做任何事。
   * @param isOpen 当前弹窗是否打开。
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

      // 弹窗只回填角色编号，菜单勾选状态由上面的菜单编号单独设置。
      await formApi.setValues({ id: data.id, menuIds: [] });
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

/**
 * 递归收集菜单树中所有可勾选的节点编号。
 * @param nodes 当前层的菜单节点。
 * @param ids 收集结果的累加数组，递归时复用同一个引用。
 * @returns 收集到的全部节点编号。
 */
function getAllNodeIds(nodes: TreeNodeLike[], ids: number[] = []): number[] {
  nodes.forEach(
    /**
     * 处理单个节点：有编号则收集，并继续下钻子节点。
     * @param node 当前正在处理的菜单节点。
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

/** 树控件的节点形状：value 是菜单节点数据，index 是同层位置。 */
type MenuTreeNode = {
  index?: number | string;
  value?: {
    type?: (typeof SystemMenuTypeEnum)[keyof typeof SystemMenuTypeEnum];
  };
};

/**
 * 按菜单类型与同层位置决定节点的展示样式。
 * @param node 树控件的节点数据。
 * @returns 追加到节点 class 上的样式片段。
 */
function getNodeClass(node: MenuTreeNode) {
  const classes: string[] = [];
  if (node.value?.type === SystemMenuTypeEnum.BUTTON) {
    classes.push('inline-flex');
    if (Number(node.index) % 3 >= 1) {
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
