/**
 * 权限指令注册入口：把 v-access 挂到 Vue 应用，
 * 在元素挂载时按角色或权限码决定是否移除。
 * 判定依据来自 use-access：前端模式且参数为 role 时按角色，
 * 其余情况按权限码判定；无权限直接移除元素，不做响应式重算。
 */
/**
 * Global authority directive
 * Used for fine-grained control of component permissions
 * @Example v-access:role="[ROLE_NAME]" or v-access:role="ROLE_NAME"
 * @Example v-access:code="[ROLE_CODE]" or v-access:code="ROLE_CODE"
 */
import type { App, Directive, DirectiveBinding } from 'vue';

import { useAccess } from './use-access';

/**
 * 判定单个元素是否有权保留：前端模式且指令参数为 role 时按角色判定，其余情况按权限码判定；
 * 指令值为数组时任一命中即通过，值为空时不干预；判定不通过直接把元素移出 DOM，
 * 因此权限变化后已移除的元素不会自动恢复。
 * @param el 指令绑定的宿主元素，无权限时会被移除。
 * @param binding 指令绑定信息，value 为角色或权限码（支持单个值与数组），arg 取 role 时走角色判定。
 */
function isAccessible(
  el: Element,
  binding: DirectiveBinding<string | string[]>,
) {
  const { accessMode, hasAccessByCodes, hasAccessByRoles } = useAccess();

  const value = binding.value;

  if (!value) return;
  const authMethod =
    accessMode.value === 'frontend' && binding.arg === 'role'
      ? hasAccessByRoles
      : hasAccessByCodes;

  const values = Array.isArray(value) ? value : [value];

  if (!authMethod(values)) {
    el?.remove();
  }
}

/** 指令挂载钩子：元素插入时立即做一次权限判定，判定结果不再随权限变化重算。 */
const mounted = (el: Element, binding: DirectiveBinding<string | string[]>) => {
  isAccessible(el, binding);
};

const authDirective: Directive = {
  mounted,
};

/**
 * 把 v-access 注册为应用级全局指令，注册后模板可用 v-access:role / v-access:code。
 * 同名指令会被覆盖，重复调用不会报错。
 * @param app 目标 Vue 应用实例，指令只在传入的实例上生效。
 */
export function registerAccessDirective(app: App) {
  app.directive('access', authDirective);
}
