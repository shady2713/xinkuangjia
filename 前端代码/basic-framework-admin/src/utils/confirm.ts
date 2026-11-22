import { ElMessageBox } from 'element-plus';

import { deleteConfirmMessage } from '@/constants/validation';

export interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'warning' | 'info' | 'success' | 'error';
}

/**
 * 统一风格二次确认弹窗，避免页面分散硬编码确认文案与按钮文本。
 */
export async function confirmAction(
  message: string,
  options: ConfirmOptions = {},
): Promise<void> {
  await ElMessageBox.confirm(message, options.title ?? '操作确认', {
    type: options.type ?? 'warning',
    confirmButtonText: options.confirmText ?? '确定',
    cancelButtonText: options.cancelText ?? '取消',
    closeOnClickModal: false,
  });
}

/**
 * 统一风格删除确认弹窗。
 */
export async function confirmDelete(targetName?: string | number | null): Promise<void> {
  await confirmAction(deleteConfirmMessage(targetName), {
    title: '删除确认',
    confirmText: '确认删除',
    cancelText: '取消',
    type: 'warning',
  });
}
