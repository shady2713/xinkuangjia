/** 将本前端的中文注释检查接入 ESLint，保留与独立入口相同的增量规则。 */
import { dirname } from 'node:path';

import {
  excluded,
  git,
  repositoryRoot,
  trackedFiles,
  webRequest,
} from './quality-scope.mjs';
import { checkWebFile } from './web-comments.mjs';

/** ESLint 在单次运行内共享 HEAD 跟踪集合，减少每个文件的重复 Git 枚举。 */
const snapshots = new Map();

/** 本工程注释规则；只报告问题，不自动添加缺少业务依据的注释。 */
const comments = {
  meta: {
    type: 'problem',
    docs: { description: '中文职责及公开调用契约完整性' },
    schema: [{ enum: ['changed', 'all'] }],
    messages: { diagnostic: '{{rule}}：{{message}}' },
  },
  /**
   * 为当前文件创建访问器，读取编辑器或 ESLint 提供的真实全文。
   * @param context - ESLint 的规则上下文。
   * @returns 仅在程序出口报告原始文件行号的访问器。
   */
  create(context) {
    return {
      /** 以完整原文核验 Vue 和 TypeScript 声明，避免虚拟脚本块丢失行号。 */
      'Program:exit': function () {
        const file = context.physicalFilename ?? context.filename;
        if (file.startsWith('<') || file.endsWith('.d.ts')) return;
        const all = context.options[0] === 'all';
        const root =
          context.settings.weetionRoot ?? repositoryRoot(dirname(file));
        const baseline = `${root}:${context.settings.weetionHead ?? ''}`;
        if (!all && !snapshots.has(baseline))
          snapshots.set(baseline, trackedFiles(root));
        const source = context.sourceCode.text;
        // 每次使用当前正文比较基线，不缓存工作区变化集合，以免漏掉编辑器后续保存。
        const request = webRequest(
          root,
          file,
          source,
          all ? null : snapshots.get(baseline),
        );
        if (
          excluded(request.path) ||
          (request.lines && request.lines.length === 0)
        )
          return;
        for (const finding of checkWebFile(request)) {
          context.report({
            loc: { line: finding.line, column: 0 },
            messageId: 'diagnostic',
            data: { rule: finding.rule, message: finding.message },
          });
        }
      },
    };
  },
};

/**
 * 构造本前端的增量 ESLint 配置，HEAD 变化会使 ESLint 的旧缓存失效。
 * @param directory - 当前前端工程目录。
 * @returns 可追加到现有 flat config 的规则配置。
 * @throws 工程不在 Git 仓库或 Git 不可用时拒绝形成通过结论。
 */
export function commentConfig(directory) {
  const root = repositoryRoot(directory);
  return {
    name: 'weetion/web-comments',
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs,vue}'],
    ignores: ['**/*.d.ts'],
    plugins: { weetion: { rules: { comments } } },
    settings: {
      weetionRoot: root,
      weetionHead: git(root, 'rev-parse', '--revs-only', 'HEAD').trim(),
    },
    rules: { 'weetion/comments': ['error', 'changed'] },
  };
}

/** 提供显式全量与增量规则给工具测试及其他本工程 ESLint 配置。 */
export default { rules: { comments } };
