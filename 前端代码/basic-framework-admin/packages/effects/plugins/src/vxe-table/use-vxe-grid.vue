<script lang="ts" setup>
/** Vben 表格网格：合并全局与调用方配置，注入分页/工具栏默认值并暴露网格 API。 */
import type { VxePagerPropTypes } from 'vxe-pc-ui';
import type {
  VxeGridDefines,
  VxeGridInstance,
  VxeGridListeners,
  VxeGridPropTypes,
  VxeGridProps as VxeTableGridProps,
} from 'vxe-table';

import type { SetupContext } from 'vue';

import type { VbenFormProps } from '@vben-core/form-ui';

import type { ExtendedVxeGridApi, VxeGridProps } from './types';

import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  toRaw,
  useSlots,
  useTemplateRef,
  watch,
} from 'vue';

import { usePriorityValues } from '@vben/hooks';
import { EmptyIcon } from '@vben/icons';
import { $t } from '@vben/locales';
import { usePreferences } from '@vben/preferences';
import {
  cloneDeep,
  cn,
  isBoolean,
  isEqual,
  mergeWithArrayOverride,
} from '@vben/utils';

import { VbenHelpTooltip, VbenLoading } from '@vben-core/shadcn-ui';

import { breakpointsTailwind, useBreakpoints } from '@vueuse/core';
import { VxeGrid, VxeUI } from 'vxe-table';

import { extendProxyOptions } from './extends';
import { useTableForm } from './init';

import 'vxe-table/es/index.css';
import 'vxe-pc-ui/es/style.css';
import './style.css';

/** 表格组件属性：在 VxeGridProps 基础上追加入口组件创建并传入的扩展表格 API 实例。 */
interface Props extends VxeGridProps {
  api: ExtendedVxeGridApi;
}

const props = withDefaults(defineProps<Props>(), {});

const FORM_SLOT_PREFIX = 'form-';

const TOOLBAR_ACTIONS = 'toolbar-actions';
const TOOLBAR_TOOLS = 'toolbar-tools';
const TABLE_TITLE = 'table-title';

const gridRef = useTemplateRef<VxeGridInstance>('gridRef');

const state = props.api?.useStore?.();

const {
  gridOptions,
  class: className,
  gridClass,
  gridEvents,
  formOptions,
  tableTitle,
  tableTitleHelp,
  showSearchForm,
  separator,
} = usePriorityValues(props, state);

const { isMobile } = usePreferences();
const breakpoints = useBreakpoints(breakpointsTailwind);
/** 搜索表单占用的栅格列数：lg 及以上 3 列、md 2 列、更窄 1 列。 */
const searchFormColumnCount = computed(() => {
  if (breakpoints.greaterOrEqual('lg').value) {
    return 3;
  }
  if (breakpoints.greaterOrEqual('md').value) {
    return 2;
  }
  return 1;
});
/** 是否渲染搜索区与表格主体之间的分隔条：未配置表单、搜索区显式隐藏或分隔条为 false 时不渲染。 */
const isSeparator = computed(() => {
  if (
    !formOptions.value ||
    showSearchForm.value === false ||
    separator.value === false
  ) {
    return false;
  }
  if (separator.value === true || separator.value === undefined) {
    return true;
  }
  return separator.value.show !== false;
});
/** 分隔条背景色：只在传入对象且显式给出 backgroundColor 时生效，否则交给样式表决定。 */
const separatorBg = computed(() => {
  return !separator.value ||
    isBoolean(separator.value) ||
    !separator.value.backgroundColor
    ? undefined
    : separator.value.backgroundColor;
});
const slots: SetupContext['slots'] = useSlots();

const [Form, formApi] = useTableForm({
  compact: true,
  /** 搜索提交：把当前表单值记为最新提交值，并让表格按新条件重载。 */
  handleSubmit: async () => {
    const formValues = await formApi.getValues();
    formApi.setLatestSubmissionValues(toRaw(formValues));
    props.api.reload(formValues);
  },
  /** 表单重置：复位后重新取值并记录；submitOnChange 已开启且值未变化时不再重复触发重载。 */
  handleReset: async () => {
    const prevValues = await formApi.getValues();
    await formApi.resetForm();
    const formValues = await formApi.getValues();
    formApi.setLatestSubmissionValues(formValues);
    // 如果值发生了变化，submitOnChange会触发刷新。所以只在submitOnChange为false或者值没有发生变化时，手动刷新
    if (isEqual(prevValues, formValues) || !formOptions.value?.submitOnChange) {
      props.api.reload(formValues);
    }
  },
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
  },
  showCollapseButton: false,
  submitButtonOptions: {
    /** 提交按钮文案：按当前语言取通用的「搜索」文案。 */
    content: computed(() => $t('common.search')),
  },
  wrapperClass: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
});

/** 判断调用方是否显式关闭折叠按钮：只有配置对象里明确写出 showCollapseButton: false 才算。 */
function isCollapseExplicitlyDisabled(options?: VbenFormProps) {
  return (
    !!options &&
    Object.prototype.hasOwnProperty.call(options, 'showCollapseButton') &&
    options.showCollapseButton === false
  );
}

/**
 * 判断是否需要显示搜索区的「展开/收起」按钮：调用方显式关闭时恒为 false，
 * 否则只有字段与搜索按钮的总数超过一行栅格时才需要折叠。
 * @param finalOptions 合并后的最终表单配置，用于统计字段与按钮占用的栅格数。
 * @param sourceOptions 调用方原始表单配置；不传时不做显式关闭判断。
 * @returns 是否需要渲染折叠按钮。
 */
function shouldShowSearchCollapseButton(
  finalOptions: VbenFormProps,
  sourceOptions?: VbenFormProps,
) {
  if (isCollapseExplicitlyDisabled(sourceOptions)) {
    return false;
  }
  const schemaCount = finalOptions.schema?.length ?? 0;
  const actionCellCount = finalOptions.showDefaultActions === false ? 0 : 1;
  // 默认筛选按钮占用一个栅格单元；字段和按钮不超过一行时，展开/收起没有实际内容可切换。
  return schemaCount + actionCellCount > searchFormColumnCount.value;
}

/** 是否显示表格标题：存在 table-title 插槽内容或配置了标题文本时为 true。 */
const showTableTitle = computed(() => {
  return !!slots[TABLE_TITLE]?.() || tableTitle.value;
});

/** 是否启用表格工具栏：存在工具栏插槽内容或需要显示标题时才启用。 */
const showToolbar = computed(() => {
  return (
    !!slots[TOOLBAR_ACTIONS]?.() ||
    !!slots[TOOLBAR_TOOLS]?.() ||
    showTableTitle.value
  );
});

/** 单列配置类型：取自 vxe-grid columns 数组的元素类型，未配置列时为 never。 */
type GridColumn = NonNullable<VxeTableGridProps['columns']>[number];

/** 判断该列是否为勾选或单选框列，用于决定默认序号列的插入位置。 */
function isSelectionColumn(column: GridColumn) {
  return column?.type === 'checkbox' || column?.type === 'radio';
}

/**
 * 在缺少序号列时补一列默认序号，插入到勾选列之后、业务数据列之前。
 * @param gridOptions 表格配置；columns 不是数组或已存在序号列时不改动。
 */
function appendDefaultSeqColumn(gridOptions: VxeTableGridProps) {
  const columns = gridOptions.columns;
  if (
    !Array.isArray(columns) ||
    columns.some((column) => column?.type === 'seq')
  ) {
    return;
  }
  const seqColumn: GridColumn = {
    type: 'seq',
    title: '序号',
    width: 60,
    align: 'center',
    headerAlign: 'center',
  };
  /** 第一个业务数据列的下标；数组里全是勾选列时为 -1，此时序号列追加在末尾。 */
  const firstDataColumnIndex = columns.findIndex(
    (column) => !isSelectionColumn(column),
  );
  const insertIndex =
    firstDataColumnIndex === -1 ? columns.length : firstDataColumnIndex;
  // 序号列默认放在勾选/单选列之后、业务数据列之前，统一所有菜单列表的阅读顺序。
  gridOptions.columns = [
    ...columns.slice(0, insertIndex),
    seqColumn,
    ...columns.slice(insertIndex),
  ];
}

/** 工具栏配置：默认关闭刷新、全屏与列设置入口，只在存在工具栏插槽或标题时才启用。 */
const toolbarOptions = computed(() => {
  const slotActions = slots[TOOLBAR_ACTIONS]?.();
  const slotTools = slots[TOOLBAR_TOOLS]?.();
  // 筛选区已经提供搜索、重置和收起操作，列表工具栏不再额外注入搜索图标，避免入口重复。
  const toolbarConfig: VxeGridPropTypes.ToolbarConfig = {
    // 列表右上角只保留业务按钮，隐藏 VXE 自带的刷新、全屏和列设置入口。
    refresh: false,
    zoom: false,
    custom: false,
    tools: (gridOptions.value?.toolbarConfig?.tools ??
      []) as VxeGridPropTypes.ToolbarConfig['tools'],
  };

  if (!showToolbar.value) {
    toolbarConfig.enabled = false;
    return { toolbarConfig };
  }

  // 强制使用固定的toolbar配置，不允许用户自定义
  // 减少配置的复杂度，以及后续维护的成本
  toolbarConfig.slots = {
    ...(slotActions || showTableTitle.value
      ? { buttons: TOOLBAR_ACTIONS }
      : {}),
    ...(slotTools ? { tools: TOOLBAR_TOOLS } : {}),
  };
  return { toolbarConfig };
});

const options = computed(
  /**
   * 合并工具栏、分页与全局网格配置，产出最终传给 vxe-grid 的 props。
   * 数组型配置按覆盖语义合并，避免默认值与调用方配置被拼接成两份。
   * @returns 可直接绑定到 vxe-grid 的完整配置对象
   */
  () => {
    const globalGridConfig = VxeUI?.getConfig()?.grid ?? {};

    const mergedOptions: VxeTableGridProps = cloneDeep(
      mergeWithArrayOverride(
        {},
        toRaw(toolbarOptions.value),
        toRaw(gridOptions.value),
        globalGridConfig,
      ),
    );

    if (mergedOptions.proxyConfig) {
      const { ajax } = mergedOptions.proxyConfig;
      mergedOptions.proxyConfig.enabled = !!ajax;
      // 不自动加载数据, 由组件控制
      mergedOptions.proxyConfig.autoLoad = false;
    }

    if (mergedOptions.pagerConfig) {
      // 窄屏时压缩分页控件：去掉跳页与页码，只保留上一页/下一页，减少横向占位。
      const mobileLayouts: VxePagerPropTypes.Layouts = [
        'PrevJump',
        'PrevPage',
        'Number',
        'NextPage',
        'NextJump',
      ];
      const layouts: VxePagerPropTypes.Layouts = [
        'Total',
        'Sizes',
        'Home',
        ...mobileLayouts,
        'End',
      ];
      mergedOptions.pagerConfig = mergeWithArrayOverride(
        {},
        mergedOptions.pagerConfig,
        {
          pageSize: 20,
          background: true,
          pageSizes: [10, 20, 30, 50, 100, 200],
          className: 'mt-2 w-full',
          layouts: isMobile.value ? mobileLayouts : layouts,
          size: 'mini' as const,
        },
      );
    }

    if (mergedOptions.formConfig) {
      mergedOptions.formConfig.enabled = false;
    }
    appendDefaultSeqColumn(mergedOptions);
    return mergedOptions;
  },
);
/** 工具栏工具点击：搜索码先触发表单开合，随后把事件原样转交给调用方注册的监听。 */
function onToolbarToolClick(event: VxeGridDefines.ToolbarToolClickEventParams) {
  if (event.code === 'search') {
    onSearchBtnClick();
  }
  (
    gridEvents.value?.toolbarToolClick as VxeGridListeners['toolbarToolClick']
  )?.(event);
}

/** 搜索按钮点击：切换搜索表单开合；API 尚未挂载时静默跳过。 */
function onSearchBtnClick() {
  props.api?.toggleSearchForm?.();
}

/** 表格事件集合：在调用方监听之上覆盖 toolbarToolClick，以插入搜索按钮的默认行为。 */
const events = computed(() => {
  return {
    ...gridEvents.value,
    toolbarToolClick: onToolbarToolClick,
  };
});

/** 需要透传给 vxe-grid 的插槽名：排除空状态、表单、加载与两个工具栏插槽。 */
const delegatedSlots = computed(() => {
  const resultSlots: string[] = [];

  for (const key of Object.keys(slots)) {
    if (
      !['empty', 'form', 'loading', TOOLBAR_ACTIONS, TOOLBAR_TOOLS].includes(
        key,
      )
    ) {
      resultSlots.push(key);
    }
  }
  return resultSlots;
});

/** 表单内的透传插槽名：取 form- 前缀的插槽，去掉前缀后交给内部表单渲染。 */
const delegatedFormSlots = computed(() => {
  const resultSlots: string[] = [];

  for (const key of Object.keys(slots)) {
    if (key.startsWith(FORM_SLOT_PREFIX)) {
      resultSlots.push(key);
    }
  }
  return resultSlots.map((key) => key.replace(FORM_SLOT_PREFIX, ''));
});

/** 是否使用内置空状态：调用方未自定义 emptyText 或 emptyRender 时才显示。 */
const showDefaultEmpty = computed(() => {
  // 检查是否有原生的 VXE Table 空状态配置
  const hasEmptyText = options.value.emptyText !== undefined;
  const hasEmptyRender = options.value.emptyRender !== undefined;

  // 如果有原生配置，就不显示默认的空状态
  return !hasEmptyText && !hasEmptyRender;
});

/**
 * 初始化表格：合并全局与本地配置，挂载 vxe-grid 并注册各区块的联动。
 * 放在 nextTick 之后执行，确保父组件已经把默认插槽内容渲染出来。
 */
async function init() {
  await nextTick();
  const globalGridConfig = VxeUI?.getConfig()?.grid ?? {};
  const defaultGridOptions: VxeTableGridProps = mergeWithArrayOverride(
    {},
    toRaw(gridOptions.value),
    toRaw(globalGridConfig),
  );
  // 内部主动加载数据，防止form的默认值影响
  const autoLoad = defaultGridOptions.proxyConfig?.autoLoad;
  const enableProxyConfig = options.value.proxyConfig?.enabled;
  if (enableProxyConfig && autoLoad) {
    props.api.grid.commitProxy?.(
      'query',
      formOptions.value ? ((await formApi.getValues()) ?? {}) : {},
    );
    // props.api.reload(formApi.form?.values ?? {});
  }

  const formConfig = gridOptions.value?.formConfig;
  // 处理某个页面加载多个Table时，第2个之后的Table初始化报出警告
  // 因为第一次初始化之后会把defaultGridOptions和gridOptions合并后缓存进State
  if (formConfig && formConfig.enabled) {
    console.warn(
      '[Vben Vxe Table]: The formConfig in the grid is not supported, please use the `formOptions` props',
    );
  }
  // 走公开的 setGridOptions 入口：它内部就是 setState({ gridOptions })，行为一致。
  props.api?.setGridOptions?.(defaultGridOptions);
  extendProxyOptions(props.api, defaultGridOptions, () =>
    formApi.getLatestSubmissionValues(),
  );
}

// formOptions支持响应式
watch(
  [formOptions, searchFormColumnCount],
  ([latestFormOptions]) => {
    formApi.setState((prev) => {
      const finalFormOptions: VbenFormProps = mergeWithArrayOverride(
        {},
        latestFormOptions,
        prev,
      );
      const showCollapseButton = shouldShowSearchCollapseButton(
        finalFormOptions,
        latestFormOptions,
      );
      return {
        ...finalFormOptions,
        showCollapseButton,
        collapseTriggerResize: showCollapseButton,
      };
    });
  },
  {
    immediate: true,
  },
);

/** 表单是否处于紧凑模式：直接读取内部表单 API 的当前状态，表单未创建时为 undefined。 */
const isCompactForm = computed(() => {
  return formApi.getState()?.compact;
});

onMounted(() => {
  props.api?.mount?.(gridRef.value, formApi);
  init();
});

onUnmounted(() => {
  formApi?.unmount?.();
  props.api?.unmount?.();
});
</script>

<template>
  <div :class="cn('bg-card h-full rounded-md', className)">
    <VxeGrid
      ref="gridRef"
      :class="
        cn(
          'p-2',
          {
            'pt-0': showToolbar && !formOptions,
          },
          gridClass,
        )
      "
      v-bind="options"
      v-on="events"
    >
      <!-- 左侧操作区域或者title -->
      <template v-if="showToolbar" #toolbar-actions="slotProps">
        <slot v-if="showTableTitle" name="table-title">
          <div
            class="flex items-center justify-center gap-1 text-[1rem] font-bold"
          >
            {{ tableTitle }}
            <VbenHelpTooltip v-if="tableTitleHelp">
              {{ tableTitleHelp }}
            </VbenHelpTooltip>
          </div>
        </slot>
        <slot name="toolbar-actions" v-bind="slotProps"> </slot>
      </template>

      <!-- 继承默认的slot -->
      <template
        v-for="slotName in delegatedSlots"
        :key="slotName"
        #[slotName]="slotProps"
      >
        <slot :name="slotName" v-bind="slotProps"></slot>
      </template>
      <template #toolbar-tools="slotProps">
        <slot name="toolbar-tools" v-bind="slotProps"></slot>
      </template>

      <!-- form表单 -->
      <template #form>
        <div
          v-if="formOptions"
          v-show="showSearchForm !== false"
          :class="
            cn(
              'relative rounded py-3',
              isCompactForm
                ? isSeparator
                  ? 'pb-8'
                  : 'pb-4'
                : isSeparator
                  ? 'pb-4'
                  : 'pb-0',
            )
          "
        >
          <slot name="form">
            <Form>
              <template
                v-for="slotName in delegatedFormSlots"
                :key="slotName"
                #[slotName]="slotProps"
              >
                <slot
                  :name="`${FORM_SLOT_PREFIX}${slotName}`"
                  v-bind="slotProps"
                ></slot>
              </template>
              <template #reset-before="slotProps">
                <slot name="reset-before" v-bind="slotProps"></slot>
              </template>
              <template #submit-before="slotProps">
                <slot name="submit-before" v-bind="slotProps"></slot>
              </template>
              <template #expand-before="slotProps">
                <slot name="expand-before" v-bind="slotProps"></slot>
              </template>
              <template #expand-after="slotProps">
                <slot name="expand-after" v-bind="slotProps"></slot>
              </template>
            </Form>
          </slot>
          <div
            v-if="isSeparator"
            :style="{
              ...(separatorBg ? { backgroundColor: separatorBg } : undefined),
            }"
            class="bg-background-deep z-100 absolute -left-2 bottom-1 h-2 w-[calc(100%+1rem)] overflow-hidden md:bottom-2 md:h-3"
          ></div>
        </div>
      </template>
      <!-- loading -->
      <template #loading>
        <slot name="loading">
          <VbenLoading :spinning="true" />
        </slot>
      </template>
      <!-- 统一控状态 -->
      <template v-if="showDefaultEmpty" #empty>
        <slot name="empty">
          <EmptyIcon class="mx-auto" />
          <div class="mt-2">{{ $t('common.noData') }}</div>
        </slot>
      </template>
    </VxeGrid>
  </div>
</template>
