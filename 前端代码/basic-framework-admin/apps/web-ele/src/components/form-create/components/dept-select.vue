<!-- 部门选择器 - 树形结构显示 -->
<script lang="ts" setup>
/**
 * 部门选择器：以树形下拉加载 /system/dept/simple-list 简表，支持多选与搜索过滤。
 * 由 plugins/form-create 按组件名注册给 JSON 表单，returnType 决定回写 id 还是名称；
 * 只读部门简表，不负责部门增删改与数据权限，部门维护仍在 system/dept 页面。
 */
import { onMounted, ref, watch } from 'vue';

import { useUserStore } from '@vben/stores';
import { handleTree, logWarn } from '@vben/utils';

import { ElTreeSelect } from 'element-plus';

import { requestClient } from '#/api/request';

defineOptions({ name: 'DeptSelect' });

const props = withDefaults(defineProps<Props>(), {
  // 注入上下文缺省为空对象，读取方无需再判空。
  formCreateInject: () => ({}),
  // 未选中任何部门时保持未设置，不要退化成空串或空数组。
  modelValue: undefined,
  multiple: false,
  returnType: 'id',
  defaultCurrentDept: false,
  disabled: false,
  placeholder: '',
});

/** update:modelValue：选中部门变化时触发，载荷口径由 returnType 决定（部门 id 或名称），清空时为 undefined */
const emit = defineEmits<{
  /**
   * 事件签名：载荷类型同时覆盖 id 与名称两种口径，实际传出哪一套由 returnType 决定。
   * @param e 事件名，固定为 update:modelValue。
   * @param value 最新的选中值；多选为数组、单选为标量，清空时为 undefined。
   */
  (
    e: 'update:modelValue',
    value: number | number[] | string | string[] | undefined,
  ): void;
}>();

/** 部门数据接口 */
interface DeptVO {
  id: number;
  name: string;
  parentId: number;
  sort?: number;
  leaderUserId?: number;
  phone?: string;
  email?: string;
  status?: number;
}

/** 部门树节点：在接口返回的部门字段上由 handleTree 补出子节点数组 */
interface DeptTreeNode extends DeptVO {
  children?: DeptTreeNode[];
}

/** 接受父组件参数 */
interface Props {
  /** 当前选中的部门，支持 v-model；multiple 为 true 时传数组 */
  modelValue?: null | number | number[] | string | string[];
  /** 是否允许多选 */
  multiple?: boolean;
  /** 返回值口径：'id' 返回部门主键，'name' 返回部门名称，默认 'id' */
  returnType?: 'id' | 'name';
  /** 无初始值时是否默认选中当前登录用户所在部门 */
  defaultCurrentDept?: boolean;
  /** 是否禁用选择 */
  disabled?: boolean;
  /** 占位提示文本 */
  placeholder?: string;
  /** form-create 表单的注入上下文，由 form-create 渲染器传入，业务方无需手工赋值 */
  formCreateInject?: Record<string, unknown>;
}

// Element Plus TreeSelect 的 props 配置
const treeProps = {
  label: 'name',
  value: 'id',
  children: 'children',
};

const deptTree = ref<DeptTreeNode[]>([]); // 部门树形数据
const deptList = ref<DeptVO[]>([]); // 原始部门列表（用于 returnType='name' 时查找名称）
const selectedValue = ref<number | number[] | undefined>(); // 当前选中值

/** 加载部门树形数据 */
async function loadDeptTree(): Promise<void> {
  try {
    const data = await requestClient.get<DeptVO[]>('/system/dept/simple-list');
    deptList.value = data;
    deptTree.value = handleTree(data);
  } catch (error) {
    logWarn('form-create:dept-select:load', error);
    deptTree.value = [];
  }
}

/** 根据 ID 获取部门名称 */
function getDeptNameById(id: number): string | undefined {
  /**
   * 在已加载的简表里按主键查部门；查不到时告警而不是静默返回，
   * 因为结果会直接回填表单，静默失败会让用户只看到空值却无从判断原因。
   */
  const dept = deptList.value.find((item: DeptVO) => item.id === id);
  if (!dept) {
    logWarn(
      'form-create:dept-select:missing-dept',
      `Missing department id: ${id}`,
    );
  }
  return dept?.name;
}

/** 根据名称获取部门 ID */
function getDeptIdByName(name: string): number | undefined {
  /** 在已加载的简表里按名称反查主键，供 returnType 为 name 时把外部值转成树选择器需要的 id。 */
  const dept = deptList.value.find((item: DeptVO) => item.name === name);
  return dept?.id;
}

/**
 * 处理选中值变化：按 returnType 把树选择器的 id 转成对外口径后抛给表单。
 * 清空时多选回填空数组、单选回传 undefined，避免把 undefined 写进必填项。
 * @param value 树选择器当前选中的值，多选时为数组，单选时为部门主键。
 */
function handleChange(value: number | number[] | undefined): void {
  if (value === undefined || value === null) {
    emit('update:modelValue', props.multiple ? [] : undefined);
    return;
  }

  // 根据 returnType 决定返回值类型
  if (props.returnType === 'name') {
    if (props.multiple && Array.isArray(value)) {
      /**
       * 把选中的 id 批量翻成部门名称；简表里查不到的 id 会被 filter 剔除，
       * 因此名称数组可能比 id 数组短，调用方不能按下标一一对应回写。
       */
      const names = value
        .map((id) => getDeptNameById(id))
        .filter(Boolean) as string[];
      emit('update:modelValue', names);
    } else if (!props.multiple && typeof value === 'number') {
      const name = getDeptNameById(value);
      emit('update:modelValue', name);
    }
  } else {
    emit('update:modelValue', value);
  }
}

/** 树节点过滤方法（支持搜索过滤） */
function filterNode(
  value: string,
  data: { children?: unknown[]; label?: string; name?: string },
): boolean {
  if (!value) return true;
  return !!data.name?.toLowerCase().includes(value.toLowerCase());
}

/** 同步 modelValue 到内部选中值 */
function syncSelectedValue(): void {
  const newValue = props.modelValue;
  if (newValue === undefined || newValue === null) {
    selectedValue.value = props.multiple ? [] : undefined;
    return;
  }

  // 如果 returnType 是 'name'，需要将名称转换为 ID 用于树选择器显示
  if (props.returnType === 'name') {
    // 只有在 deptList 加载完成后才能进行转换
    if (deptList.value.length === 0) {
      return;
    }
    if (props.multiple && Array.isArray(newValue)) {
      selectedValue.value = (newValue as string[])
        .map((name) => getDeptIdByName(name))
        .filter(Boolean) as number[];
    } else if (!props.multiple && typeof newValue === 'string') {
      selectedValue.value = getDeptIdByName(newValue);
    }
  } else {
    selectedValue.value = newValue as number | number[];
  }
}

/** 监听 modelValue 变化，同步到内部选中值 */
watch(() => props.modelValue, syncSelectedValue, { immediate: true });

/** 监听 deptList 变化，重新同步选中值（解决数据加载完成后的回显问题） */
watch(() => deptList.value, syncSelectedValue);

/**
 * 检查外部是否已给出有效预设值：undefined、null、空串与空数组都算没有预设。
 * @returns 存在至少一个有效预设值时为 true，否则为 false。
 */
function hasValidPresetValue(): boolean {
  const value = props.modelValue;
  if (value === undefined || value === null || value === '') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

/** 设置默认值（当前用户部门） */
function setDefaultValue(): void {
  // 仅当 defaultCurrentDept 为 true 时处理
  if (!props.defaultCurrentDept) {
    return;
  }
  // 检查是否已有预设值（预设值优先级高于默认当前部门）
  if (hasValidPresetValue()) {
    return;
  }

  // 获取当前用户的部门 ID
  const userStore = useUserStore();
  const deptId = userStore.userInfo?.deptId as number | undefined;
  // 处理 deptId 为空或 0 的边界情况
  if (!deptId || deptId === 0) {
    return;
  }

  // 根据多选模式决定默认值格式
  const defaultValue = props.multiple ? [deptId] : deptId;
  emit('update:modelValue', defaultValue);
}

/** 组件挂载时加载数据并设置默认值 */
onMounted(async () => {
  await loadDeptTree();
  // 数据加载完成后设置默认值
  setDefaultValue();
});
</script>

<template>
  <ElTreeSelect
    v-model="selectedValue"
    class="w-full"
    :data="deptTree"
    :props="treeProps"
    :multiple="multiple"
    :disabled="disabled"
    :placeholder="placeholder || '请选择部门'"
    :check-strictly="true"
    :filterable="true"
    :filter-node-method="filterNode"
    :clearable="true"
    node-key="id"
    @change="handleChange"
  />
</template>
