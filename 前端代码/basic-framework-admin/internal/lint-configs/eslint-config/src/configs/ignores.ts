/**
 * 全局忽略清单：让 ESLint 跳过依赖、构建产物、锁文件、缓存与生成文件。
 * 只声明忽略范围，不改变任何规则的严重级别；src 下的业务代码仍全部纳入检查。
 */
import type { Linter } from 'eslint';

/**
 * 生成 ESLint 的全局忽略清单。
 * @returns 只含 ignores 的配置数组，覆盖依赖、构建产物、锁文件与生成文件，不含任何规则设置。
 */
export async function ignores(): Promise<Linter.Config[]> {
  return [
    {
      ignores: [
        '**/node_modules',
        '**/dist',
        '**/dist-*',
        '**/*-dist',
        '**/.husky',
        '**/.nitro',
        '**/.output',
        '**/Dockerfile',
        '**/package-lock.json',
        '**/yarn.lock',
        '**/pnpm-lock.yaml',
        '**/bun.lockb',
        '**/output',
        '**/coverage',
        '**/temp',
        '**/.temp',
        '**/tmp',
        '**/.tmp',
        '**/.history',
        '**/.turbo',
        '**/.nuxt',
        '**/.next',
        '**/.vercel',
        '**/.changeset',
        '**/.idea',
        '**/.cache',
        '**/.output',
        '**/.vite-inspect',

        '**/CHANGELOG*.md',
        '**/*.min.*',
        '**/LICENSE*',
        '**/__snapshots__',
        '**/*.snap',
        '**/fixtures/**',
        '**/.vitepress/cache/**',
        '**/auto-import?(s).d.ts',
        '**/components.d.ts',
        '**/vite.config.mts.*',
        '**/*.sh',
        '**/*.ttf',
        '**/*.woff',
        '**/public/**',
        '**/china.json',
        '**/lefthook.yml',
      ],
    },
  ];
}
