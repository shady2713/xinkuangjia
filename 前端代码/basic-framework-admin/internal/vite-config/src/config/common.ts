/**
 * 应用与库构建共用的 Vite 构建基线：放宽 chunk 体积告警阈值，
 * 关闭压缩体积上报与 sourcemap 输出。
 *
 * 只提供 build 段的兜底值，插件、server、css 由各自配置补齐。
 */
import type { UserConfig } from 'vite';

/**
 * 应用与库构建共用的 build 段兜底值。
 * @returns 只含 build 字段的配置：放宽 chunk 体积告警阈值，关闭压缩体积上报与 sourcemap。
 */
async function getCommonConfig(): Promise<UserConfig> {
  return {
    build: {
      chunkSizeWarningLimit: 2000,
      reportCompressedSize: false,
      sourcemap: false,
    },
  };
}

export { getCommonConfig };
