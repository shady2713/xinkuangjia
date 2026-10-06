<script lang="ts" setup>
/**
 * 用户页左侧部门树：加载精简部门列表，支持按名称过滤后点选单个节点。
 * 选中结果经 select 事件交给父组件触发用户查询，自身不请求用户数据。
 */
import type { SystemDeptApi } from '#/api/system/dept';

import { onMounted, ref } from 'vue';

import { Search } from '@vben/icons';
import { handleTree, logError } from '@vben/utils';

import { ElInput, ElTree } from 'element-plus';

import { getSimpleDeptList } from '#/api/system/dept';

const emit = defineEmits(['select']);
const deptList = ref<SystemDeptApi.Dept[]>([]); // 部门列表
const deptTree = ref<SystemDeptApi.Dept[]>([]); // 部门树
const expandedKeys = ref<number[]>([]); // 展开的节点
const loading = ref(false); // 加载状态
const searchValue = ref(''); // 搜索值

/** 处理搜索逻辑 */
function handleSearch(value: string) {
  searchValue.value = value;
  const filteredList = value
    ? deptList.value.filter((item) =>
        item.name.toLowerCase().includes(value.toLowerCase()),
      )
    : deptList.value;
  deptTree.value = handleTree(filteredList);
  // 展开所有节点；缺少 id 的节点无法被 ElTree 定位，天然排除
  expandedKeys.value = deptTree.value
    .map(
      /**
       * 取出节点主键，作为 ElTree 的展开依据。
       * @param node 当前部门树节点。
       * @returns 节点主键；DTO 未提供时为 undefined。
       */
      (node) => node.id,
    )
    .filter(
      /**
       * 剔除缺少主键的节点，它们无法被 ElTree 定位。
       * @param id 节点主键。
       * @returns 主键存在时返回 true。
       */
      (id): id is number => id !== undefined,
    );
}

/** 选中部门 */
function handleSelect(data: { id: number; label: string }) {
  emit('select', data);
}

/** 初始化 */
onMounted(async () => {
  try {
    loading.value = true;
    const data = await getSimpleDeptList();
    deptList.value = data;
    deptTree.value = handleTree(data);
  } catch (error) {
    logError('system:user:dept-tree:load', error);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <ElInput
      placeholder="搜索部门"
      clearable
      v-model="searchValue"
      @input="handleSearch"
      class="w-full"
    >
      <template #prefix>
        <Search class="size-4" />
      </template>
    </ElInput>
    <div v-loading="loading">
      <ElTree
        class="pt-2"
        v-if="deptTree.length > 0"
        :data="deptTree"
        :props="{ label: 'name', children: 'children' }"
        @node-click="handleSelect"
        default-expand-all
        node-key="id"
      />
      <div v-else-if="!loading" class="py-4 text-center text-gray-500">
        暂无数据
      </div>
    </div>
  </div>
</template>
