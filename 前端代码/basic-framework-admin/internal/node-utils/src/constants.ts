/**
 * 终端符号常量：集中定义成功与失败图标，避免脚本各自硬编码转义字符。
 * 只导出 UNICODE 枚举，不含着色与输出，颜色由调用方的 chalk 负责。
 */
enum UNICODE {
  FAILURE = '\u2716', // ✖
  SUCCESS = '\u2714', // ✔
}

export { UNICODE };
