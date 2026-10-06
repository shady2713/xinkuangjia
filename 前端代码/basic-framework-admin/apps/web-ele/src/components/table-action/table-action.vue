<script setup lang="ts">
/**
 * 表格操作列组件：按权限码与 ifShow 过滤 actions 与 dropDownActions，
 * 渲染主按钮区与「更多」下拉，带 popConfirm 的动作统一走二次确认。
 * 只负责按钮展示与动作分派，列表刷新由调用方传入的回调完成。
 */
import type { PropType } from 'vue';

import type { ActionItem, ButtonType } from './typing';

import { computed, toRaw } from 'vue';

import { useAccess } from '@vben/access';
import { IconifyIcon } from '@vben/icons';
import { $t } from '@vben/locales';
import { isFunction } from '@vben/utils';

import {
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElMessageBox,
  ElSpace,
  ElTooltip,
} from 'element-plus';

const props = defineProps({
  /** 主操作区的按钮列表；每项支持 label、type、auth（权限码，无权限时隐藏）、ifShow（显隐条件）等配置 */
  actions: {
    type: Array as PropType<ActionItem[]>,
    default() {
      return [];
    },
  },
  /** 折叠进"更多"下拉菜单的按钮列表，配置项与 actions 相同 */
  dropDownActions: {
    type: Array as PropType<ActionItem[]>,
    default() {
      return [];
    },
  },
  /** 主操作区按钮之间是否显示分隔线 */
  divider: {
    type: Boolean,
    default: true,
  },
});

const { hasAccessByCodes } = useAccess();

type ResolvedAction = ActionItem & {
  label: string;
  type: ButtonType;
};

type DropdownAction = Omit<ActionItem, 'text'> & {
  divider: boolean;
  label: string;
  text: string;
};

/** 是否显示 */
function isIfShow(action: ActionItem): boolean {
  const ifShow = action.ifShow;
  let visible = true;
  if (typeof ifShow === 'boolean') {
    visible = ifShow;
  }
  if (isFunction(ifShow)) {
    visible = ifShow(action);
  }
  if (visible) {
    visible =
      hasAccessByCodes(action.auth || []) || (action.auth || []).length === 0;
  }
  return visible;
}

/** 处理按钮 actions */
const getActions = computed<ResolvedAction[]>(() => {
  return (toRaw(props.actions) || [])
    .filter((action) => {
      return (
        (hasAccessByCodes(action.auth || []) ||
          (action.auth || []).length === 0) &&
        isIfShow(action)
      );
    })
    .map((action) => ({
      ...action,
      label: action.label || '',
      type: (action.type || 'primary') as ButtonType,
    }));
});

const getDropdownList = computed<DropdownAction[]>(() => {
  return (toRaw(props.dropDownActions) || [])
    .filter((action) => {
      return (
        (hasAccessByCodes(action.auth || []) ||
          (action.auth || []).length === 0) &&
        isIfShow(action)
      );
    })
    .map((action, index) => {
      const { label } = action;
      return {
        ...action,
        label: label || '',
        text: label || '',
        divider:
          index < props.dropDownActions.length - 1 ? props.divider : false,
      };
    });
});

/**
 * 确认操作后执行动作回调；用户取消时只通知取消回调。
 * @param action 已经过权限过滤、包含确认配置的操作
 * @returns 确认流程结束结果，禁用操作不会执行回调
 * @throws 确认后的动作回调失败时继续向调用方传播错误
 */
async function handlePopConfirmAction(action: DropdownAction | ResolvedAction) {
  const popConfirm = action.popConfirm;
  if (!popConfirm || action.disabled || popConfirm.disabled) {
    return;
  }
  try {
    // 表格单条删除沿用批量删除的 MessageBox 样式，避免行内小气泡遮挡表格内容。
    await ElMessageBox.confirm(popConfirm.title, {
      cancelButtonText: popConfirm.cancelText || $t('common.cancel'),
      confirmButtonText: popConfirm.okText || $t('common.confirm'),
      type: 'warning',
    });
  } catch {
    popConfirm.cancel?.();
    return;
  }
  await popConfirm.confirm?.();
}

function getButtonProps(action: ResolvedAction) {
  const res = {
    ...action,
    label: action.label || '',
    type: (action.type || 'primary') as ButtonType,
  };
  // onClick 由模板中的 @click 统一触发，避免 v-bind 再透传一次导致按钮逻辑执行两遍。
  delete res.onClick;
  delete res.icon;
  delete res.auth;
  delete res.ifShow;
  delete res.popConfirm;
  delete res.tooltip;
  return res;
}

/**
 * 按权限过滤后的菜单索引分派动作或确认流程。
 * @param command 下拉组件返回的动作索引
 */
function handleMenuClick(command: number | string) {
  const action = getDropdownList.value[Number(command)];
  if (action?.popConfirm) {
    handlePopConfirmAction(action);
    return;
  }
  if (action?.onClick && isFunction(action.onClick)) {
    action.onClick();
  }
}
</script>

<template>
  <div class="table-actions">
    <ElSpace
      :size="
        getActions?.some((item: ActionItem) => item.type === 'text') ? 0 : 8
      "
    >
      <template v-for="(action, index) in getActions" :key="index">
        <ElTooltip
          v-if="action.popConfirm"
          v-bind="
            action.tooltip &&
            ((typeof action.tooltip === 'string' && action.tooltip) ||
              (typeof action.tooltip === 'object' && action.tooltip.content))
              ? typeof action.tooltip === 'string'
                ? { content: action.tooltip }
                : { ...action.tooltip }
              : { disabled: true }
          "
        >
          <ElButton
            v-bind="getButtonProps(action)"
            @click="handlePopConfirmAction(action)"
          >
            <template v-if="action.icon">
              <IconifyIcon :icon="action.icon" class="mr-1" />
            </template>
            {{ action.label }}
          </ElButton>
        </ElTooltip>
        <ElTooltip
          v-else-if="
            action.tooltip &&
            ((typeof action.tooltip === 'string' && action.tooltip) ||
              (typeof action.tooltip === 'object' && action.tooltip.content))
          "
          v-bind="
            typeof action.tooltip === 'string'
              ? { content: action.tooltip }
              : { ...action.tooltip }
          "
        >
          <ElButton v-bind="getButtonProps(action)" @click="action.onClick">
            <template v-if="action.icon">
              <IconifyIcon :icon="action.icon" class="mr-1" />
            </template>
            {{ action.label }}
          </ElButton>
        </ElTooltip>
        <ElButton
          v-else
          v-bind="getButtonProps(action)"
          @click="action.onClick"
        >
          <template v-if="action.icon">
            <IconifyIcon :icon="action.icon" class="mr-1" />
          </template>
          {{ action.label }}
        </ElButton>
      </template>
    </ElSpace>

    <!-- 下拉组件必须直接识别按钮；Tooltip 的多根节点会阻断触发引用和菜单事件。 -->
    <ElDropdown
      v-if="getDropdownList.length > 0"
      trigger="click"
      @command="handleMenuClick"
    >
      <slot name="more">
        <ElButton
          :aria-label="$t('page.action.more')"
          :title="$t('page.action.more')"
          class="table-actions__more"
          :type="getDropdownList[0]?.type"
          link
        >
          <IconifyIcon icon="lucide:ellipsis-vertical" />
        </ElButton>
      </slot>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem
            v-for="(action, index) in getDropdownList"
            :key="index"
            :command="index"
            :disabled="action.disabled"
          >
            <div>
              <IconifyIcon v-if="action.icon" :icon="action.icon" />
              <span :class="action.icon ? 'ml-1' : ''">
                {{ action.text || action.label }}
              </span>
            </div>
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>
  </div>
</template>
<style lang="scss">
.table-actions {
  .el-button--text {
    padding: 4px;
    margin-left: 0;
  }

  .table-actions__more {
    /* 下拉入口只保留三点图标，避免“更多”和图标表达重复，同时保持行高稳定。 */
    min-width: 24px;
    padding: 0 2px;
    font-size: 16px;
  }

  .el-button .iconify + span,
  .el-button span + .iconify {
    margin-inline-start: 4px;
  }

  .iconify {
    display: inline-flex;
    align-items: center;
    width: 1em;
    height: 1em;
    font-style: normal;
    line-height: 0;
    vertical-align: -0.125em;
    color: inherit;
    text-align: center;
    text-transform: none;
    text-rendering: optimizelegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
}
</style>
