/**
 * 类名合并工具：clsx 组装后交给 tailwind-merge 去重，消解 Tailwind 冲突类。
 * 供组件 class 属性使用；不处理样式作用域，也不感知组件库前缀。
 */
import type { ClassValue } from 'clsx';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并组件 class：先用 clsx 展开字符串/数组/对象/条件写法，再由 tailwind-merge 消解冲突的 Tailwind 类。
 * @param inputs - 任意数量的 class 取值，假值会被忽略。
 * @returns 去重后的 class 字符串，同族 Tailwind 类保留后出现的一个；无有效输入时为空串。
 */
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 对外暴露 `cn` 接受的单个 class 取值类型：
// 组件的 `class` 属性只会被交给 `cn` 合并，声明 `any` 会让调用方完全失去检查。
export type { ClassValue };
export { cn };
