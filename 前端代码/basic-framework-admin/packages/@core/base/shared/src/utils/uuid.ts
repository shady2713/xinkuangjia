/**
 * 前端本地标识生成：为表单字段名、DOM id 等场景提供唯一字符串。
 * buildUUID 输出 32 位随机十六进制串。
 * buildShortUUID 在其上拼前缀、自增序号与毫秒时间戳。
 * 随机源是 Math.random，不得用作安全令牌或跨端一致性标识。
 */
const hexList: string[] = [];
for (let i = 0; i <= 15; i++) {
  hexList[i] = i.toString(16);
}

/**
 * 生成 32 位随机十六进制串：按 UUID v4 的位置规则填 4 与 8~b，再去掉全部连字符。
 * 随机源是 Math.random，只适合做本地键名，不能当安全令牌或跨端一致性标识。
 * @returns 32 个小写十六进制字符组成的字符串，不含连字符。
 */
export function buildUUID(): string {
  let uuid = '';
  for (let i = 1; i <= 36; i++) {
    switch (i) {
      case 9:
      case 14:
      case 19:
      case 24: {
        uuid += '-';
        break;
      }
      case 15: {
        uuid += 4;
        break;
      }
      case 20: {
        uuid += hexList[(Math.random() * 4) | 8];
        break;
      }
      default: {
        uuid += hexList[Math.trunc(Math.random() * 16)];
      }
    }
  }
  return uuid.replaceAll('-', '');
}

let unique = 0;
/**
 * 生成比 buildUUID 更短、可读性更好的本地标识：前缀 + 随机数 + 进程内自增序号 + 毫秒时间戳。
 * 依赖模块级自增计数，因此刷新页面后序号会从 1 重新开始。
 * @param prefix - 标识前缀，用于在日志或 DOM id 中区分业务场景，省略时以空串开头。
 * @returns 形如 `prefix_1234567890123456789` 的字符串；同一页面内连续调用不会重复。
 */
export function buildShortUUID(prefix = ''): string {
  const time = Date.now();
  const random = Math.floor(Math.random() * 1_000_000_000);
  unique++;
  return `${prefix}_${random}${unique}${String(time)}`;
}
