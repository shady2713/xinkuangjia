/**
 * IFrame 视图安全策略工具：校验允许渲染的协议，并对同源嵌套剥离 allow-same-origin 防止沙箱逃逸。
 */

/** 允许的安全外部/同源 iframe 协议集合。 */
const ALLOWED_IFRAME_PROTOCOLS = new Set(['http:', 'https:']);

/** 控制字符匹配，拒绝将换行或空字节注入 URL。 */
const CONTROL_CHAR_PATTERN = /\p{Cc}/u;

/** 同源 iframe 沙箱策略：移除 allow-same-origin，禁止访问宿主同源 Cookie 与 localStorage。 */
const SAME_ORIGIN_SANDBOX = 'allow-scripts allow-forms allow-popups';

/** 跨源 iframe 沙箱策略：按跨源权限最小集放行脚本文档交互。 */
const CROSS_ORIGIN_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-popups';

/**
 * 校验并清洗路由配置中的 iframe 地址，仅允许站内单斜杠绝对路径或 http(s) 地址。
 *
 * @param rawSrc 路由 meta 中的原始 iframe 地址
 * @returns 安全可用的 iframe 地址；为空或协议非法时返回空字符串
 */
export function resolveSafeIframeSrc(rawSrc: unknown): string {
  if (typeof rawSrc !== 'string') {
    return '';
  }
  const trimmed = rawSrc.trim();
  if (!trimmed || CONTROL_CHAR_PATTERN.test(trimmed)) {
    return '';
  }
  if (trimmed.startsWith('/')) {
    return trimmed.startsWith('//') ? '' : trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    return ALLOWED_IFRAME_PROTOCOLS.has(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

/**
 * 计算 iframe 的 sandbox 属性值；同源页面强制剥离 allow-same-origin 阻断沙箱逃逸。
 *
 * @param safeSrc 已通过协议校验的 iframe 地址
 * @param currentOrigin 当前宿主站点源（protocol + host）
 * @returns 对应同源或跨源场景的最小权限 sandbox 策略字符串
 */
export function resolveIframeSandbox(
  safeSrc: string,
  currentOrigin: string,
): string {
  if (!safeSrc) {
    return SAME_ORIGIN_SANDBOX;
  }
  try {
    const targetOrigin = new URL(safeSrc, currentOrigin).origin;
    return targetOrigin === currentOrigin
      ? SAME_ORIGIN_SANDBOX
      : CROSS_ORIGIN_SANDBOX;
  } catch {
    return SAME_ORIGIN_SANDBOX;
  }
}
