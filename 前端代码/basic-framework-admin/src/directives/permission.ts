/**
 * 按钮级权限指令 `v-has-permi` / `v-hasPermi` 与通用权限判断函数。
 */
import type { App, DirectiveBinding } from 'vue';

import { useUserStore } from '@/stores/user';

const ALL_PERMISSION = '*:*:*';

/**
 * 判断当前权限集合是否命中目标权限（任意满足其一即可）。
 */
export function matchPermission(
  required: string | string[] | undefined,
  granted: string[],
): boolean {
  if (!required || (Array.isArray(required) && required.length === 0)) {
    return true;
  }
  if (granted.includes(ALL_PERMISSION)) {
    return true;
  }
  const list = Array.isArray(required) ? required : [required];
  return list.some((code) => granted.includes(code));
}

export function hasPermission(required: string | string[] | undefined): boolean {
  const userStore = useUserStore();
  return matchPermission(required, userStore.permissions);
}

function checkBinding(
  el: HTMLElement,
  binding: DirectiveBinding<string | string[]>,
): void {
  if (!hasPermission(binding.value)) {
    el.parentNode?.removeChild(el);
  }
}

export function registerPermissionDirective(app: App): void {
  app.directive('hasPermi', {
    mounted: checkBinding,
    updated: checkBinding,
  });
}
