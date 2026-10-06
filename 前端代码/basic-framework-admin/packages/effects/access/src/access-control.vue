<!--
 Access control component for fine-grained access control.
 TODO: 可以扩展更完善的功能：
 1. 支持多个权限码，只要有一个权限码满足即可 或者 多个权限码全部满足
 2. 支持多个角色，只要有一个角色满足即可 或者 多个角色全部满足
 3. 支持自定义权限码和角色的判断逻辑
-->
<script lang="ts" setup>
/**
 * 细粒度权限包裹组件：命中 codes 才渲染默认插槽，否则不输出内容。
 * type 决定判定方式：role 按用户角色，code 按权限码，
 * codes 内任一命中即通过；codes 为 undefined 时无条件渲染。
 * 只做渲染开关，接口侧鉴权仍由后端负责。
 */
import { computed } from 'vue';

import { useAccess } from './use-access';

/** 权限包裹组件的属性：codes 给出判定集合，type 决定按角色还是按权限码判定。 */
interface Props {
  /**
   * Specified codes is visible
   * @default []
   */
  codes?: string[];

  /**
   * 通过什么方式来控制组件，如果是 role，则传入角色，如果是 code，则传入权限码
   * @default 'role'
   */
  type?: 'code' | 'role';
}

defineOptions({
  name: 'AccessControl',
});

const props = withDefaults(defineProps<Props>(), {
  /** 默认插槽默认值：codes 非空时为要求集合，空数组表示不限制。 */
  codes: () => [],
  type: 'role',
});

const { hasAccessByCodes, hasAccessByRoles } = useAccess();

/** 组件最终是否渲染默认插槽；type 为 role 走角色判定，否则走权限码判定。 */
const hasAuth = computed(() => {
  const { codes, type } = props;
  return type === 'role' ? hasAccessByRoles(codes) : hasAccessByCodes(codes);
});
</script>

<template>
  <slot v-if="!codes"></slot>
  <slot v-else-if="hasAuth"></slot>
</template>
