interface OpenWindowOptions {
  noopener?: boolean;
  noreferrer?: boolean;
  target?: '_blank' | '_parent' | '_self' | '_top' | string;
}

/**
 * 校验待打开地址仅允许 HTTP(S) 绝对地址或站内单斜杠路径，阻断 `javascript:` / `data:` 伪协议。
 *
 * @param url 待检查的 URL
 * @returns 协议安全返回 true
 */
function isSafeNavigationUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  return /^https?:\/\//iu.test(trimmed) || /^\/(?!\/)/u.test(trimmed);
}

/**
 * 在受控安全属性（默认启用 `noopener,noreferrer`）下打开新窗口。
 *
 * @param url 需要打开的受信网址
 * @param options 打开窗口的选项
 */
function openWindow(url: string, options: OpenWindowOptions = {}): void {
  if (!isSafeNavigationUrl(url)) {
    return;
  }
  const { noopener = true, noreferrer = true, target = '_blank' } = options;

  const features = [noopener && 'noopener=yes', noreferrer && 'noreferrer=yes']
    .filter(Boolean)
    .join(',');

  // 统一安全窗口出口（由 scan-production 阻断其余源码裸调 window.open）
  window.open(url, target, features);
}

/**
 * 在新窗口中打开当前应用内路由。
 *
 * @param path 应用内路由路径
 */
function openRouteInNewWindow(path: string) {
  const { hash, origin } = location;
  const fullPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${origin}${hash && !fullPath.startsWith('/#') ? '/#' : ''}${fullPath}`;
  openWindow(url, { target: '_blank' });
}

export { isSafeNavigationUrl, openRouteInNewWindow, openWindow };
