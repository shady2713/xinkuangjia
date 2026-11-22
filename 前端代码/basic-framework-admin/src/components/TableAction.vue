<script setup lang="ts">
/**
 * 1:1 复刻原 Vben 5 TableAction：
 * - 行内常用操作以带图标 link 按钮呈现，支持统一 Popconfirm 二次确认
 * - 次要操作统一收进「更多」下拉菜单，避免操作列过宽遮挡数据列
 * - 内置权限码过滤（auth），无权限时自动隐藏按钮或更多菜单
 */
import { ArrowDown } from '@element-plus/icons-vue';
import { type Component, computed } from 'vue';

import { hasPermission } from '@/directives/permission';

export interface TableActionItem {
  label: string;
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'default';
  icon?: Component;
  auth?: string | string[];
  show?: boolean;
  disabled?: boolean;
  popConfirm?: {
    title: string;
    confirm: () => void | Promise<void>;
  };
  onClick?: () => void | Promise<void>;
}

const props = withDefaults(
  defineProps<{
    actions?: TableActionItem[];
    dropDownActions?: TableActionItem[];
  }>(),
  {
    actions: () => [],
    dropDownActions: () => [],
  },
);

const visibleActions = computed(() =>
  props.actions.filter((item) => item.show !== false && hasPermission(item.auth)),
);

const visibleDropDownActions = computed(() =>
  props.dropDownActions.filter(
    (item) => item.show !== false && hasPermission(item.auth),
  ),
);

function handleDropdownCommand(index: number) {
  const item = visibleDropDownActions.value[index];
  if (item && !item.disabled && item.onClick) {
    void item.onClick();
  }
}
</script>

<template>
  <div class="inline-flex flex-nowrap items-center justify-center gap-1 whitespace-nowrap">
    <template v-for="(action, idx) in visibleActions" :key="`${action.label}-${idx}`">
      <el-popconfirm
        v-if="action.popConfirm"
        :title="action.popConfirm.title"
        width="240"
        confirm-button-text="确定"
        cancel-button-text="取消"
        @confirm="action.popConfirm.confirm()"
      >
        <template #reference>
          <el-button
            link
            :type="action.type || 'primary'"
            :icon="action.icon"
            :disabled="action.disabled"
          >
            {{ action.label }}
          </el-button>
        </template>
      </el-popconfirm>
      <el-button
        v-else
        link
        :type="action.type || 'primary'"
        :icon="action.icon"
        :disabled="action.disabled"
        @click="action.onClick?.()"
      >
        {{ action.label }}
      </el-button>
    </template>

    <el-dropdown
      v-if="visibleDropDownActions.length > 0"
      trigger="click"
      @command="handleDropdownCommand"
    >
      <el-button link type="primary" class="ml-0.5">
        更多
        <el-icon class="ml-0.5"><ArrowDown /></el-icon>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="(item, idx) in visibleDropDownActions"
            :key="`${item.label}-${idx}`"
            :command="idx"
            :disabled="item.disabled"
            :class="{ '!text-[#ef4444]': item.type === 'danger' }"
          >
            <el-icon v-if="item.icon" class="mr-1.5">
              <component :is="item.icon" />
            </el-icon>
            {{ item.label }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>
