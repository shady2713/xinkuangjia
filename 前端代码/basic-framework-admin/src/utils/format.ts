/**
 * 日期时间、文件大小格式化与 Blob 下载工具。
 */
import dayjs from 'dayjs';

export function formatDateTime(
  value?: number | string | Date | null,
  pattern = 'YYYY-MM-DD HH:mm:ss',
): string {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  const d = dayjs(value);
  return d.isValid() ? d.format(pattern) : String(value);
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 校验外部或同源跳转/预览地址，仅放行 http: 与 https: 协议，阻断 javascript:/data:/vbscript: 等危险 scheme。
 */
export function resolveSafeHttpUrl(raw?: string | null): string | null {
  if (!raw || !raw.trim()) {
    return null;
  }
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(raw.trim(), base);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    // 非法 URL 一律拒绝
  }
  return null;
}
