import type { ClassValue } from 'clsx';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 对外暴露 `cn` 接受的单个 class 取值类型：
// 组件的 `class` 属性只会被交给 `cn` 合并，声明 `any` 会让调用方完全失去检查。
export type { ClassValue };
export { cn };
