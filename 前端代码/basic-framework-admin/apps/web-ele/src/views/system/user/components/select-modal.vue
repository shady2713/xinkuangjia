<script lang="ts" setup>
// 说明：当前实现已按本项目的 web-ele 结构整理。
import type { SystemDeptApi } from '#/api/system/dept';
import type { SystemUserApi } from '#/api/system/user';

import { computed, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { handleTree } from '@vben/utils';

import {
  ElButton,
  ElCol,
  ElInput,
  ElPagination,
  ElRow,
  ElTransfer,
  ElTree,
} from 'element-plus';

import { getSimpleDeptList } from '#/api/system/dept';
import { getUserPage } from '#/api/system/user';
import { showWarningMessage } from '#/utils/feedback';

// 部门树节点接口
interface DeptTreeNode {
  id: string;
  label: string;
  children?: DeptTreeNode[];
  name: string;
}

type DeptSourceNode = {
  children?: DeptSourceNode[];
  id?: number;
  name?: string;
};

defineOptions({ name: 'UserSelectModal' });

withDefaults(
  defineProps<{
    cancelText?: string;
    confirmText?: string;
    multiple?: boolean;
    title?: string;
    value?: number[];
  }>(),
  {
    title: '选择用户',
    multiple: true,
    value: () => [],
    confirmText: '确定',
    cancelText: '取消',
  },
);

const emit = defineEmits<{
  cancel: [];
  closed: [];
  confirm: [value: SystemUserApi.User[]];
  'update:value': [value: number[]];
}>();

// 部门树数据
const deptTree = ref<DeptTreeNode[]>([]);
const deptList = ref<SystemDeptApi.Dept[]>([]);
const expandedKeys = ref<string[]>([]);
const selectedDeptId = ref<number>();
const deptSearchKeys = ref('');

// 用户数据管理
const userList = ref<SystemUserApi.User[]>([]); // 存储所有已知用户
const selectedUserIds = ref<number[]>([]);

// 弹窗配置
const [Modal, modalApi] = useVbenModal({
  onCancel: handleCancel,
  onClosed: handleClosed,
  /**
   * 弹窗开合时加载或清空左右两侧的用户数据。
   * 打开时先取回调用方传入的已选用户 ID，加载后回填并预取其完整信息；
   * 关闭时清空本地状态，避免下次打开残留上一次的勾选。
   * @param isOpen 弹窗当前是否处于打开状态
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      resetData();
      return;
    }
    // 加载数据；调用方通过 setData 传入已选中的用户 ID
    const data = modalApi.getData<{ userIds?: number[] }>();
    if (!data) {
      return;
    }
    modalApi.lock();
    try {
      // 加载部门数据
      const deptData = await getSimpleDeptList();
      deptList.value = deptData;
      const treeData = handleTree(deptData) as DeptSourceNode[];
      deptTree.value = treeData.map((node) => processDeptNode(node));
      expandedKeys.value = deptTree.value.map((node) => node.id);

      // 加载初始用户数据
      await loadUserData(1, leftListState.value.pagination.pageSize);

      // 设置已选用户
      if (data.userIds?.length) {
        selectedUserIds.value = data.userIds;
        // 预加载已选用户的完整信息（当前仍通过分页接口补齐）
        const { list } = await getUserPage({
          pageNo: 1,
          pageSize: 100, // 临时使用固定值确保能加载所有已选用户
          userIds: data.userIds,
        });
        // 使用 Map 来去重，以用户 ID 为 key
        const userMap = new Map(userList.value.map((user) => [user.id, user]));
        list.forEach((user) => {
          if (!userMap.has(user.id)) {
            userMap.set(user.id, user);
          }
        });
        userList.value = [...userMap.values()];
        updateRightListData();
      }

      modalApi.open();
    } finally {
      modalApi.unlock();
    }
  },
  destroyOnClose: true,
});

// 左侧列表状态
const leftListState = ref({
  searchValue: '',
  dataSource: [] as SystemUserApi.User[],
  pagination: {
    current: 1,
    pageSize: 10,
    total: 0,
  },
});

// 右侧列表状态；检索由 ElTransfer 的 filterable 面板负责，本状态只保留分页与数据源
const rightListState = ref({
  dataSource: [] as SystemUserApi.User[],
  pagination: {
    current: 1,
    pageSize: 10,
    total: 0,
  },
});

// 计算属性：Transfer 数据源
const transferDataSource = computed(
  /**
   * 汇总左右两侧的用户为 Transfer 数据源：按用户主键去重，只收录有主键的用户，
   * 并把 Map 的键直接复用为 Transfer 的 key，避免同一用户因出现在两侧而重复。
   * @returns Transfer 组件的数据源，元素含 key / label / disabled。
   */
  () => {
    // 使用 Map 来去重，确保每个用户只出现一次；只收录有 id 的用户
    const userMap = new Map<number, SystemUserApi.User>();

    // 先添加左侧数据
    for (const user of leftListState.value.dataSource) {
      if (user.id) {
        userMap.set(user.id, user);
      }
    }

    // 再添加右侧数据（如果已存在则不会重复添加）
    for (const user of rightListState.value.dataSource) {
      if (user.id && !userMap.has(user.id)) {
        userMap.set(user.id, user);
      }
    }

    // 转换为 Transfer 需要的格式；Map 的键就是用户 id，直接复用，无需再从行数据上取
    return [...userMap.entries()].map(
      /**
       * 把「主键 + 用户」条目转成 Transfer 的展示项。
       * @param entry Map 条目。
       * @param entry.0 用户主键，作为 Transfer 选项的 key。
       * @param entry.1 用户数据，用于拼出展示用的昵称与账号。
       * @returns Transfer 需要的展示项，主键即 key。
       */
      ([id, user]) => ({
        key: id,
        label: `${user.nickname} (${user.username})`,
        disabled: false,
      }),
    );
  },
);

// 过滤部门树数据
const filteredDeptTree = computed(
  /**
   * 按搜索关键字过滤部门树；关键字为空时直接返回原树，避免无谓的深拷贝。
   * @returns 命中关键字的部门节点列表，父节点在子节点都未命中时被剔除。
   */
  () => {
    if (!deptSearchKeys.value) return deptTree.value;

    /**
     * 按关键字递归过滤部门树。
     * @param node 当前部门节点。
     * @param depth 当前递归深度，用于避免过深的树导致爆栈。
     * @returns 命中关键字时返回保留后的节点；自身与子树都未命中时返回 null。
     */
    const filterNode = (node: DeptTreeNode, depth = 0): DeptTreeNode | null => {
      // 添加深度限制，防止过深的递归导致爆栈
      if (depth > 100) return null;

      // 按部门名称搜索
      const name = node?.name?.toLowerCase();
      const search = deptSearchKeys.value.toLowerCase();

      // 如果当前节点匹配，直接返回节点，不处理子节点
      if (name?.includes(search)) {
        return {
          ...node,
          children: node.children,
        };
      }

      // 如果当前节点不匹配，检查子节点
      if (node.children) {
        const filteredChildren = node.children
          .map(
            /**
             * 递归处理每个子节点，未命中的返回 null，留给下一步过滤。
             * @param child 当前子节点。
             */
            (child) => filterNode(child, depth + 1),
          )
          // filter(Boolean) 不会在类型层剔除 null，必须用类型谓词。
          .filter(
            /**
             * 剔除未命中的子树，命中任一子节点时其父节点才会被保留。
             * @param child 递归处理后的子节点，未命中时为 null。
             */
            (child): child is DeptTreeNode => child !== null,
          );

        if (filteredChildren.length > 0) {
          return {
            ...node,
            children: filteredChildren,
          };
        }
      }

      return null;
    };

    return deptTree.value
      .map(
        /**
         * 对每个根节点执行同一套递归过滤。
         * @param node 当前根节点。
         */
        (node) => filterNode(node),
      )
      .filter(
        /**
         * 剔除自身与子树都未命中的根节点，命中项才交给树组件渲染。
         * @param node 递归处理后的根节点，未命中时为 null。
         */
        (node): node is DeptTreeNode => node !== null,
      );
  },
);

// 加载用户数据
async function loadUserData(pageNo: number, pageSize: number) {
  try {
    const { list, total } = await getUserPage({
      pageNo,
      pageSize,
      deptId: selectedDeptId.value,
      username: leftListState.value.searchValue || undefined,
    });

    leftListState.value.dataSource = list;
    leftListState.value.pagination.total = total;
    leftListState.value.pagination.current = pageNo;
    leftListState.value.pagination.pageSize = pageSize;

    // 更新用户列表缓存
    const newUsers = list.filter(
      (user) => !userList.value.some((u) => u.id === user.id),
    );
    if (newUsers.length > 0) {
      userList.value.push(...newUsers);
    }
  } finally {
    //
  }
}

// 更新右侧列表数据
function updateRightListData() {
  // 使用 Set 来去重选中的用户ID
  const uniqueSelectedIds = new Set(selectedUserIds.value);

  // 获取选中的用户，确保不重复；缺少 id 的用户无法被勾选命中
  const selectedUsers = userList.value.filter(
    /**
     * 只保留被勾选且主键存在的用户。
     * @param user 候选用户。
     * @returns 该用户属于当前勾选集合时返回 true。
     */
    (user) => user.id !== undefined && uniqueSelectedIds.has(user.id),
  );

  // 已选用户的检索由 ElTransfer 自身的 filterable 面板完成，这里只按勾选集合汇总。
  // 更新总数（使用 Set 确保唯一性）
  rightListState.value.pagination.total = new Set(
    selectedUsers.map(/** 只取主键用于去重计数。 */ (user) => user.id),
  ).size;

  // 应用分页
  const { current, pageSize } = rightListState.value.pagination;
  const startIndex = (current - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  rightListState.value.dataSource = selectedUsers.slice(startIndex, endIndex);
}

// 处理左侧分页变化
async function handleLeftPaginationChange(page: number) {
  await loadUserData(page, leftListState.value.pagination.pageSize);
}

// 处理右侧分页变化
function handleRightPaginationChange(page: number) {
  rightListState.value.pagination.current = page;
  updateRightListData();
}

// 处理用户选择变化
function handleUserChange(
  value: (number | string)[],
  _direction: string,
  _movedKeys: (number | string)[],
) {
  // 使用 Set 来去重选中的用户ID，并确保转换为 number 类型
  selectedUserIds.value = [...new Set(value.map(Number))];
  emit('update:value', selectedUserIds.value);
  updateRightListData();
}

// 重置数据
function resetData() {
  userList.value = [];
  selectedUserIds.value = [];

  // 取消部门选中
  selectedDeptId.value = undefined;

  // 取消选中的用户
  selectedUserIds.value = [];

  leftListState.value = {
    searchValue: '',
    dataSource: [],
    pagination: {
      current: 1,
      pageSize: 10,
      total: 0,
    },
  };

  rightListState.value = {
    dataSource: [],
    pagination: {
      current: 1,
      pageSize: 10,
      total: 0,
    },
  };
}

// 处理部门搜索
function handleDeptSearch(value: string) {
  deptSearchKeys.value = value;

  // 如果有搜索结果，自动展开所有节点
  if (value) {
    const getAllKeys = (nodes: DeptTreeNode[]): string[] => {
      const keys: string[] = [];
      for (const node of nodes) {
        keys.push(String(node.id));
        if (node.children) {
          keys.push(...getAllKeys(node.children));
        }
      }
      return keys;
    };
    expandedKeys.value = getAllKeys(deptTree.value);
  } else {
    // 清空搜索时，只展开第一级节点
    expandedKeys.value = deptTree.value.map((node) => node.id);
  }
}

// 处理部门选择
async function handleDeptSelect(node: DeptTreeNode) {
  // 更新选中的部门ID
  const newDeptId = node.id ? Number(node.id) : undefined;
  selectedDeptId.value =
    newDeptId === selectedDeptId.value ? undefined : newDeptId;

  // 重置分页并加载数据
  const { pageSize } = leftListState.value.pagination;
  leftListState.value.pagination.current = 1;
  await loadUserData(1, pageSize);
}

// 确认选择
function handleConfirm() {
  if (selectedUserIds.value.length === 0) {
    showWarningMessage('请选择用户');
    return;
  }
  emit(
    'confirm',
    // 缺少 id 的用户无法被勾选命中，天然排除
    userList.value.filter(
      /**
       * 只保留主键存在且已被勾选的用户。
       * @param user 候选用户。
       * @returns 该用户属于当前勾选集合时返回 true。
       */
      (user) =>
        user.id !== undefined && selectedUserIds.value.includes(user.id),
    ),
  );
  modalApi.close();
}

// 取消选择
function handleCancel() {
  emit('cancel');
  modalApi.close();
  // 确保在动画结束后再重置数据
  setTimeout(() => {
    resetData();
  }, 300);
}

// 关闭弹窗
function handleClosed() {
  emit('closed');
  resetData();
}

// 递归处理部门树节点
function processDeptNode(node: DeptSourceNode): DeptTreeNode {
  return {
    id: String(node.id ?? ''),
    label: `${node.name ?? ''} (${node.id ?? ''})`,
    name: node.name ?? '',
    children: node.children?.map((child) => processDeptNode(child)),
  };
}
</script>

<template>
  <Modal key="user-select-modal" class="w-3/5" :title="title">
    <ElRow :gutter="16">
      <ElCol :span="6">
        <div class="h-[500px] overflow-auto rounded border">
          <div class="border-b p-2">
            <ElInput
              v-model="deptSearchKeys"
              placeholder="搜索部门"
              clearable
              @input="handleDeptSearch"
            />
          </div>
          <ElTree
            :data="filteredDeptTree"
            :expand-on-click-node="false"
            :default-expanded-keys="expandedKeys"
            :current-node-key="
              selectedDeptId ? String(selectedDeptId) : undefined
            "
            node-key="id"
            highlight-current
            @node-click="handleDeptSelect"
          >
            <template #default="{ node }">
              <span>{{ node.label }}</span>
            </template>
          </ElTree>
        </div>
      </ElCol>
      <ElCol :span="18">
        <ElTransfer
          v-model="selectedUserIds"
          :data="transferDataSource"
          :titles="['未选', '已选']"
          filterable
          filter-placeholder="搜索用户"
          @change="handleUserChange"
        >
          <template #default="{ option }">
            <span>{{ option.label }}</span>
          </template>
        </ElTransfer>
        <div class="mt-2 flex justify-between">
          <ElPagination
            v-model:current-page="leftListState.pagination.current"
            v-model:page-size="leftListState.pagination.pageSize"
            :total="leftListState.pagination.total"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next"
            small
            @current-change="handleLeftPaginationChange"
          />
          <ElPagination
            v-model:current-page="rightListState.pagination.current"
            v-model:page-size="rightListState.pagination.pageSize"
            :total="rightListState.pagination.total"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next"
            small
            @current-change="handleRightPaginationChange"
          />
        </div>
      </ElCol>
    </ElRow>
    <template #footer>
      <ElButton @click="handleCancel">{{ cancelText }}</ElButton>
      <ElButton
        type="primary"
        :disabled="selectedUserIds.length === 0"
        @click="handleConfirm"
      >
        {{ confirmText }}
      </ElButton>
    </template>
  </Modal>
</template>

<style lang="scss" scoped>
:deep(.el-transfer) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 450px;
}

:deep(.el-transfer-panel) {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
}

:deep(.el-transfer-panel__header) {
  flex-shrink: 0;
}

:deep(.el-transfer-panel__filter) {
  flex-shrink: 0;
  padding: 8px;
}

:deep(.el-transfer-panel__body) {
  flex: 1;
  overflow: auto;
}

:deep(.el-transfer-panel__list) {
  height: auto !important;
}

:deep(.el-transfer__buttons) {
  padding: 0 8px;
}
</style>
