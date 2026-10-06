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
export function buildShortUUID(prefix = ''): string {
  const time = Date.now();
  const random = Math.floor(Math.random() * 1_000_000_000);
  unique++;
  return `${prefix}_${random}${unique}${String(time)}`;
}
