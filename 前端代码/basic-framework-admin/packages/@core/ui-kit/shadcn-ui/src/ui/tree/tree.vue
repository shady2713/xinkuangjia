<script lang="ts" setup>
/**
 * 通用树形选择组件：把后端返回的父子结构拍平成一维数组后交给 reka-ui 渲染，
 * 并在组件内部维护展开集合与选中值，支持多选、父级联动勾选和禁用节点跳过。
 * 展开、收起、全选等动作通过 defineExpose 暴露，供弹窗和表单场景直接调用。
 */
import type { Arrayable } from '@vueuse/core';
import type { FlattenedItem } from 'reka-ui';

import type { ClassType, Recordable } from '@vben-core/typings';

import type { TreeNode, TreeProps } from './types';

import { onMounted, ref, watch, watchEffect } from 'vue';

import { ChevronRight, IconifyIcon } from '@vben-core/icons';
import { cn, get } from '@vben-core/shared/utils';

import { TreeItem, TreeRoot } from 'reka-ui';

import { Checkbox } from '../checkbox';
import { treePropsDefaults } from './types';

const props = withDefaults(defineProps<TreeProps>(), treePropsDefaults());

const emits = defineEmits<{
  expand: [value: FlattenedItem<TreeNode>];
  select: [value: FlattenedItem<TreeNode>];
}>();

/**
 * 拍平后的单个节点：在原始数据之外补齐渲染与联动勾选所需的层级信息。
 * @template T 原始节点的数据类型，通常是部门或菜单这类结构化对象。
 * @template P 节点标识类型，由 valueField 决定，可能是数字也可能是字符串。
 */
interface InnerFlattenItem<T = Recordable<unknown>, P = number | string> {
  /** 是否存在可展开的子节点；childrenField 缺失或为空数组时为 false。 */
  hasChildren: boolean;
  /** 当前节点的标识，取自 valueField 指定的字段。 */
  id: P;
  /** 节点深度，根节点为 0，逐层加一，用于模板中的缩进计算。 */
  level: number;
  /** 父节点标识；根节点为 null。 */
  parentId: null | P;
  /** 从根节点到父节点的标识链，父级联动勾选按此顺序回溯。 */
  parents: P[];
  /** 原始节点数据，保持原引用供取值和 node 插槽使用。 */
  value: T;
}

/**
 * 深度优先把树形数据拍平成一维数组，供渲染、取值和联动勾选共用。
 * @param items 当前层级的节点数组。
 * @param childrenField 子节点数组在节点上的字段名，缺失时按叶子节点处理。
 * @param level 当前层级；根节点传入 0，递归进入子节点时自动加一。
 * @param parentId 父节点标识；根节点为 null。
 * @param parents 从根到父节点的标识链，递归时在末尾追加当前节点标识。
 * @returns 按先序遍历排列的扁平节点数组，父节点一定排在子节点之前。
 */
function flatten<T = Recordable<unknown>, P = number | string>(
  items: T[],
  childrenField: string = 'children',
  level = 0,
  parentId: null | P = null,
  parents: P[] = [],
): InnerFlattenItem<T, P>[] {
  const result: InnerFlattenItem<T, P>[] = [];
  items.forEach(
    /**
     * 摊平单个节点：先写入自身，再按需递归子节点，保证父节点排在子节点之前。
     * @param item 当前待处理的节点数据。
     */
    (item) => {
      const children = get(item, childrenField) as Array<T>;
      const id = get(item, props.valueField) as P;
      const val: InnerFlattenItem<T, P> = {
        hasChildren: Array.isArray(children) && children.length > 0,
        id,
        level,
        parentId,
        parents: [...parents],
        value: item,
      };
      result.push(val);
      if (val.hasChildren)
        result.push(
          ...flatten(children, childrenField, level + 1, id, [...parents, id]),
        );
    },
  );
  return result;
}

const flattenData = ref<Array<InnerFlattenItem>>([]);
const modelValue = defineModel<Arrayable<number | string>>();
const expanded = ref<Array<number | string>>(props.defaultExpandedKeys ?? []);

// defaultExpandedKeys 允许调用方异步下发，深度监听保证外部改动能覆盖本地展开状态。
watch(
  () => props.defaultExpandedKeys,
  /**
   * 用外部下发的展开键整体覆盖本地状态。
   * @param newVal 调用方最新下发的展开键集合；为空或 undefined 表示全部收起。
   */
  (newVal) => {
    expanded.value = newVal ?? [];
  },
  { deep: true },
);

const treeValue = ref();
// treeData 每次变更都要重新拍平；用序列化结果判断是否真的换了数据，避免重复触发默认展开。
let lastTreeData: null | string = null;

// 放在 onMounted 内注册，组件卸载时随作用域自动停止，避免残留的副作用继续改写展开状态。
onMounted(() => {
  watchEffect(() => {
    flattenData.value = flatten(props.treeData, props.childrenField);
    updateTreeValue();

    // 只在 treeData 变化时执行展开
    const currentTreeData = JSON.stringify(props.treeData);
    if (lastTreeData !== currentTreeData) {
      lastTreeData = currentTreeData;
      if (
        props.defaultExpandedLevel !== undefined &&
        props.defaultExpandedLevel > 0
      ) {
        expandToLevel(props.defaultExpandedLevel);
      }
    }
  });
});

/**
 * 读取节点上由 valueField 指定的取值。
 * @param node 树节点数据。
 * @returns 命中取值字段且为字符串或数字时返回该值，否则返回 undefined。
 */
function nodeValue(node: TreeNode): number | string | undefined {
  const value = get(node, props.valueField);
  return typeof value === 'number' || typeof value === 'string'
    ? value
    : undefined;
}

/**
 * 读取节点上由 childrenField 指定的子节点。
 * @param node 树节点数据。
 * @returns 子节点数组；该字段缺失或不是数组时视为叶子节点，返回空数组。
 */
function nodeChildren(node: TreeNode): TreeNode[] {
  const children = get(node, props.childrenField);
  return Array.isArray(children) ? children : [];
}

/**
 * 读取节点上由 iconField 指定的图标名。
 * @param node 树节点数据。
 * @returns 图标名；该字段不是字符串时返回 undefined，模板据此不渲染图标。
 */
function nodeIcon(node: TreeNode): string | undefined {
  const icon = get(node, props.iconField);
  return typeof icon === 'string' ? icon : undefined;
}

/**
 * 按节点标识反查原始节点数据，供受控值回填和对外暴露方法使用。
 * @param value 目标节点的标识。
 * @returns 命中的节点数据；当前树数据中没有该标识时返回 undefined。
 */
function getItemByValue(value: number | string) {
  return flattenData.value.find(
    /**
     * 比较候选节点的标识是否等于目标标识。
     * @param item 当前候选的扁平节点。
     */
    (item) => nodeValue(item.value) === value,
  )?.value;
}

/**
 * 按当前 v-model 值重新推导交给 reka-ui 的受控值，并剔除已失效或被禁用的标识。
 * 无值、多值、单值三条分支都保证 treeValue 的形状与 multiple 一致。
 */
function updateTreeValue() {
  const val = modelValue.value;
  if (val === undefined) {
    treeValue.value = props.multiple ? [] : undefined;
  } else if (Array.isArray(val)) {
    if (val.length === 0) {
      treeValue.value = [];
    } else {
      const filteredValues = val.filter(
        /**
         * 只保留仍存在于当前树数据中且未被禁用的标识，避免向渲染层下发无效节点。
         * @param v 待校验的已选标识。
         */
        (v) => {
          const item = getItemByValue(v);
          return item && !isNodeDisabled({ value: item });
        },
      );
      treeValue.value = filteredValues.map(
        /**
         * 把已选标识换算成节点数据，reka-ui 需要节点本身而不是标识。
         * @param v 过滤后保留下来的已选标识。
         */
        (v) => getItemByValue(v),
      );

      // 回写到 v-model，让调用方同步知道哪些标识被丢弃。
      if (filteredValues.length !== val.length) {
        modelValue.value = filteredValues;
      }
    }
  } else {
    const item = getItemByValue(val);
    if (item && !get(item, props.disabledField)) {
      treeValue.value = item;
    } else {
      treeValue.value = props.multiple ? [] : undefined;
      modelValue.value = props.multiple ? [] : undefined;
    }
  }
}

/**
 * 接收渲染层回传的新选中节点并写回 v-model，多选时按父级联动规则过滤禁用节点。
 * @param val 渲染层给出的新选中节点集合或单个节点。
 */
function updateModelValue(val: Arrayable<TreeNode>) {
  if (Array.isArray(val)) {
    const filteredVal = val.filter(
      /**
       * 多选时禁用节点不参与回填，避免禁用项被程序化写入选中集合。
       * @param v 本次回传的候选节点。
       */
      (v) => !isNodeDisabled({ value: v }),
    );
    // 命中取值字段的节点才参与回填，缺取值的节点直接剔除。
    modelValue.value = filteredVal
      .map(
        /**
         * 把节点换算成标识。
         * @param v 通过禁用过滤的节点。
         */
        (v) => nodeValue(v),
      )
      .filter(
        /**
         * 丢弃取不到标识的节点，保证 v-model 中不出现 undefined。
         * @param v 换算后的候选标识。
         */
        (v): v is number | string => v !== undefined,
      );
  } else {
    if (val && !isNodeDisabled({ value: val })) {
      const value = nodeValue(val);
      if (value !== undefined) {
        modelValue.value = value;
      }
    }
  }
}

/**
 * 展开到指定层级，用于实现“一级/二级展开”这类受控初始状态。
 * @param level 目标展开层级，从 1 起算；1 表示只展开根节点。
 */
function expandToLevel(level: number) {
  // 展开键与 expanded 保持同一类型：树节点的键既可能是数字也可能是字符串。
  const keys: Array<number | string> = [];
  flattenData.value.forEach(
    /**
     * 收集目标层级以内的节点标识；取不到标识的节点直接跳过。
     * @param item 当前候选的扁平节点。
     */
    (item) => {
      const value = nodeValue(item.value);
      if (item.level <= level - 1 && value !== undefined) {
        keys.push(value);
      }
    },
  );
  expanded.value = keys;
}

/**
 * 收起指定节点，支持传入单个标识或标识数组。
 * @param value 需要收起的节点标识或标识集合。
 */
function collapseNodes(value: Arrayable<number | string>) {
  const keys = new Set(Array.isArray(value) ? value : [value]);
  expanded.value = expanded.value.filter(
    /**
     * 从展开集合中剔除被指定收起的标识，其余保持不变。
     * @param key 当前展开集合中的标识。
     */
    (key) => !keys.has(key),
  );
}

/**
 * 展开指定节点，标识不存在或已展开时保持原状，避免重复写入导致渲染抖动。
 * @param value 需要展开的节点标识或标识集合。
 */
function expandNodes(value: Arrayable<number | string>) {
  const keys = [...(Array.isArray(value) ? value : [value])];
  keys.forEach(
    /**
     * 只把当前树数据中确实存在的标识写入展开集合。
     * @param key 待展开的节点标识。
     */
    (key) => {
      if (expanded.value.includes(key)) return;
      const item = getItemByValue(key);
      if (item) {
        expanded.value.push(key);
      }
    },
  );
}

/**
 * 展开全部可展开节点；取不到标识的节点无法参与展开，直接剔除。
 */
function expandAll() {
  expanded.value = flattenData.value
    .filter(
      /**
       * 只有存在子节点的节点才是“展开”这一操作的有效对象。
       * @param item 当前候选的扁平节点。
       */
      (item) => item.hasChildren,
    )
    .map(
      /**
       * 把节点换算成展开键。
       * @param item 存在子节点的扁平节点。
       */
      (item) => nodeValue(item.value),
    )
    .filter(
      /**
       * 丢弃取不到标识的节点，保证展开集合只含合法标识。
       * @param key 换算后的候选展开键。
       */
      (key): key is string => key !== undefined,
    );
}

/**
 * 收起全部节点。
 */
function collapseAll() {
  expanded.value = [];
}

/**
 * 全选所有未被禁用的节点并同步内部受控值；单选模式下不适用，直接返回。
 */
function checkAll() {
  if (!props.multiple) return;
  modelValue.value = [
    ...new Set(
      flattenData.value
        .filter(
          /**
           * 禁用节点不允许被勾选，全选时必须跳过。
           * @param item 当前候选的扁平节点。
           */
          (item) => !isNodeDisabled(item),
        )
        .map(
          /**
           * 把节点换算成已选标识。
           * @param item 通过禁用过滤的扁平节点。
           */
          (item) => nodeValue(item.value),
        )
        .filter(
          /**
           * 丢弃取不到标识的节点，否则 v-model 中会出现 undefined。
           * @param key 换算后的候选标识。
           */
          (key): key is string => key !== undefined,
        ),
    ),
  ];
  updateTreeValue();
}

/**
 * 取消全部选中并同步内部受控值；单选模式下不适用，直接返回。
 */
function unCheckAll() {
  if (!props.multiple) return;
  modelValue.value = [];
  updateTreeValue();
}

/**
 * 判断节点当前是否不可操作。
 * @param item 待判断的节点，reka-ui 的扁平节点和临时包装对象都可传入。
 * @param item.value 节点真正的业务数据，disabledField 就在这个对象上取值。
 * @returns 组件整体禁用或节点自身命中 disabledField 时为 true。
 */
function isNodeDisabled(item: { value: TreeNode }) {
  return props.disabled || Boolean(get(item.value, props.disabledField));
}

/**
 * 把展开事件透传给调用方，供外部记录用户手动展开的节点。
 * @param item 触发展开的扁平节点。
 */
function onToggle(item: FlattenedItem<TreeNode>) {
  emits('expand', item);
}

/**
 * 处理节点勾选：先拦截禁用节点，再按 autoCheckParent 联动父级，最后同步受控值并抛出事件。
 * @param item 被操作的扁平节点。
 * @param isSelected 本次操作是勾选还是取消勾选。
 */
function onSelect(item: FlattenedItem<TreeNode>, isSelected: boolean) {
  if (isNodeDisabled(item)) {
    return;
  }

  // 勾选时自下而上补齐父级，保证父节点状态与已选子节点一致。
  if (
    !props.checkStrictly &&
    props.multiple &&
    props.autoCheckParent &&
    isSelected
  ) {
    flattenData.value
      .find(
        /**
         * 找到当前节点在扁平数组中的副本，从它的 parents 链回溯祖先。
         * @param i 当前候选的扁平节点。
         */
        (i) => {
          return nodeValue(i.value) === nodeValue(item.value);
        },
      )
      ?.parents?.filter(
        /**
         * 剔除链上未定义的标识，避免把无效值写入选中集合。
         * @param parent 祖先链上的一个标识。
         */
        (parent) => parent !== undefined,
      )
      ?.forEach(
        /**
         * 把尚未选中的祖先补入选中集合。
         * @param p 待补选的祖先节点标识。
         */
        (p) => {
          if (
            Array.isArray(modelValue.value) &&
            !modelValue.value.includes(p)
          ) {
            modelValue.value.push(p);
          }
        },
      );
  }
  // 取消勾选时自上而下检查：某级父节点下再无已选子节点时，父节点也要取消。
  if (
    !props.checkStrictly &&
    props.multiple &&
    props.autoCheckParent &&
    !isSelected
  ) {
    flattenData.value
      .find(
        /**
         * 找到当前节点在扁平数组中的副本，用于取 parents 链。
         * @param i 当前候选的扁平节点。
         */
        (i) => {
          return nodeValue(i.value) === nodeValue(item.value);
        },
      )
      ?.parents?.filter(
        /**
         * 剔除链上未定义的标识。
         * @param parent 祖先链上的一个标识。
         */
        (parent) => parent !== undefined,
      )
      // 从根往下遍历，保证上级判定完成后再处理下级，避免先取消父级再被子级"复活"。
      ?.toReversed()
      .forEach(
        /**
         * 逐级判断祖先是否还需要保持选中。
         * @param p 待判断的祖先节点标识。
         */
        (p) => {
          const children = flattenData.value.filter(
            /**
             * 收集该祖先下仍处于选中范围的其他直接子节点。
             * @param i 当前候选的扁平节点。
             */
            (i) => {
              return (
                i.parents.length > 0 &&
                i.parents.includes(p) &&
                i.id !== item._id &&
                i.parentId === p
              );
            },
          );
          if (Array.isArray(modelValue.value)) {
            const hasSelectedChild = children.some(
              /**
               * 判断该祖先下是否还有已选中的直接子节点。
               * @param child 该祖先下的直接子节点。
               */
              (child) => {
                const value = nodeValue(child.value);
                return (
                  value !== undefined &&
                  Array.isArray(modelValue.value) &&
                  modelValue.value.includes(value)
                );
              },
            );
            // 子节点全部取消后才取消父节点，避免出现半选状态被误清除。
            if (!hasSelectedChild) {
              const index = modelValue.value.indexOf(p);
              if (index !== -1) {
                modelValue.value.splice(index, 1);
              }
            }
          }
        },
      );
  }
  updateTreeValue();
  emits('select', item);
}

defineExpose({
  collapseAll,
  collapseNodes,
  expandAll,
  expandNodes,
  checkAll,
  unCheckAll,
  expandToLevel,
  getItemByValue,
});
</script>
<template>
  <TreeRoot
    :get-key="(item) => String(nodeValue(item) ?? '')"
    :get-children="(item) => nodeChildren(item)"
    :items="treeData"
    :model-value="treeValue"
    v-model:expanded="expanded as string[]"
    :default-expanded="defaultExpandedKeys as string[]"
    :propagate-select="!checkStrictly"
    :multiple="multiple"
    :disabled="disabled"
    :selection-behavior="allowClear || multiple ? 'toggle' : 'replace'"
    @update:model-value="updateModelValue"
    v-slot="{ flattenItems }"
    :class="
      cn(
        'text-blackA11 container select-none list-none rounded-lg text-sm font-medium',
        $attrs.class as unknown as ClassType,
        bordered ? 'border' : '',
      )
    "
  >
    <div
      :class="
        cn('my-0.5 flex w-full items-center p-1', bordered ? 'border-b' : '')
      "
      v-if="$slots.header"
    >
      <slot name="header"> </slot>
    </div>
    <div
      :class="
        cn('my-0.5 flex w-full items-center p-1', bordered ? 'border-b' : '')
      "
      v-if="treeData.length > 0"
    >
      <div
        class="flex size-5 flex-1 cursor-pointer items-center"
        @click="() => (expanded?.length > 0 ? collapseAll() : expandAll())"
      >
        <ChevronRight
          :class="{ 'rotate-90': expanded?.length > 0 }"
          class="size-4 cursor-pointer text-foreground/80 transition hover:text-foreground"
        />
        <Checkbox
          v-if="multiple"
          @click.stop
          @update:model-value="
            (checked: boolean | 'indeterminate') =>
              checked === true ? checkAll() : unCheckAll()
          "
        />
      </div>
    </div>
    <TransitionGroup :name="transition ? 'fade' : ''">
      <TreeItem
        v-for="item in flattenItems"
        v-slot="{
          isExpanded,
          isSelected,
          isIndeterminate,
          handleSelect,
          handleToggle,
        }"
        :key="item._id"
        :style="{ 'margin-left': `${item.level - 1}rem` }"
        :class="
          cn('cursor-pointer', getNodeClass?.(item), {
            'data-[selected]:bg-accent': !multiple,
            'cursor-not-allowed text-foreground/50': isNodeDisabled(item),
          })
        "
        v-bind="
          Object.assign(item.bind, {
            onfocus: isNodeDisabled(item) ? 'this.blur()' : undefined,
            disabled: isNodeDisabled(item),
          })
        "
        @select="
          (event: any) => {
            if (isNodeDisabled(item)) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (event.detail.originalEvent.type === 'click') {
              event.preventDefault();
            }
            onSelect(item, event.detail.isSelected);
          }
        "
        @toggle="
          (event: any) => {
            if (event.detail.originalEvent.type === 'click') {
              event.preventDefault();
            }
            !isNodeDisabled(item) && onToggle(item);
          }
        "
        class="tree-node focus:ring-grass8 my-0.5 flex items-center rounded p-1 outline-none focus:ring-2"
      >
        <ChevronRight
          v-if="item.hasChildren && nodeChildren(item.value).length > 0"
          class="size-4 cursor-pointer text-foreground/80 transition hover:text-foreground"
          :class="{ 'rotate-90': isExpanded }"
          @click.stop="
            () => {
              handleToggle();
              onToggle(item);
            }
          "
        />
        <div v-else class="h-4 w-4"></div>
        <div class="flex items-center gap-1">
          <Checkbox
            v-if="multiple"
            :model-value="isSelected && !isNodeDisabled(item)"
            :disabled="isNodeDisabled(item)"
            :indeterminate="isIndeterminate && !isNodeDisabled(item)"
            @click="
              (event: MouseEvent) => {
                if (isNodeDisabled(item)) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                handleSelect();
              }
            "
          />
          <div
            class="flex items-center gap-1"
            @click="
              (event: MouseEvent) => {
                if (isNodeDisabled(item)) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                handleSelect();
              }
            "
          >
            <slot name="node" v-bind="item">
              <IconifyIcon
                class="size-4"
                v-if="showIcon && nodeIcon(item.value)"
                :icon="nodeIcon(item.value) ?? ''"
              />
              {{ get(item.value, labelField) ?? '' }}
            </slot>
          </div>
        </div>
        <div class="h-4 w-4"></div>
      </TreeItem>
    </TransitionGroup>
    <div
      :class="
        cn('my-0.5 flex w-full items-center p-1', bordered ? 'border-t' : '')
      "
      v-if="$slots.footer"
    >
      <slot name="footer"> </slot>
    </div>
  </TreeRoot>
</template>
<style lang="scss" scoped>
.container {
  position: relative;
  padding: 0;
  list-style-type: none;
}

.item {
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  background-color: #f3f3f3;
  border: 1px solid #666;
}

/* 1. 声明过渡效果 */
.fade-move,
.fade-enter-active,
.fade-leave-active {
  transition: all 0.5s cubic-bezier(0.55, 0, 0.1, 1);
}

/* 2. 声明进入和离开的状态 */
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: scaleY(0.01) translate(30px, 0);
}

/* 3. 确保离开的项目被移除出了布局流
      以便正确地计算移动时的动画效果。 */
.fade-leave-active {
  position: absolute;
}
</style>
