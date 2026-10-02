/** 本前端的注释及仓库 Mermaid 检查入口；退出码 0 通过、1 规则失败、2 环境失败。 */
import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import MarkdownIt from 'markdown-it';

import {
  changedFiles,
  discover,
  readText,
  repositoryRoot,
  trackedFiles,
  webRequest,
} from '../internal/lint-configs/eslint-config/src/rules/quality-scope.mjs';
import { checkWebFile } from '../internal/lint-configs/eslint-config/src/rules/web-comments.mjs';
import { checkMermaid } from './mermaid-parser.mjs';

/**
 * 提取真实 Markdown Mermaid 围栏，保留 BOM、前置元数据和原始行号语义。
 * @param path - 报告使用的相对路径。
 * @param source - Markdown 原文。
 * @returns 图表正文及其在文件中的起始行号。
 */
export function mermaidBlocks(path, source) {
  // YAML 元数据不是正文；用空行遮蔽以保留后续图表的原始位置。
  const text = source.replace(
    /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/u,
    /** 元数据中的反引号不得被当作图表。 */ (value) =>
      '\n'.repeat((value.match(/\n/gu) ?? []).length),
  );
  return new MarkdownIt('commonmark')
    .parse(text, {})
    .filter(
      /** 只选择真正的 Mermaid 围栏，排除嵌套代码示例。 */ (token) =>
        token.type === 'fence' &&
        token.info.trim().split(/\s+/u)[0].toLowerCase() === 'mermaid',
    )
    .map(
      /** 围栏下一行即图表正文起点。 */ (token) => ({
        path,
        line: token.map[0] + 2,
        source: token.content,
      }),
    );
}

/**
 * 执行当前前端的命令；Web 默认只选本工程，Mermaid 默认选整个仓库。
 * @param argv - 模式、范围与选项，路径相对于 --root 或仓库根目录。
 * @returns 检查退出码；结果写入标准输出。
 * @throws 参数、路径、编码、Git 或依赖无效时交给命令入口报告环境失败。
 */
export async function run(argv) {
  const [mode, ...options] = argv;
  if (options.includes('--help') || mode === '--help') {
    console.log(
      '用法：node scripts/check-quality.mjs web|mermaid [--root 路径] [--all] [--json] [仓库相对路径...]',
    );
    return 0;
  }
  if (!['mermaid', 'web'].includes(mode))
    throw new Error('请选择 web 或 mermaid 检查');
  const paths = [];
  let full = false;
  let json = false;
  let root;
  for (let index = 0; index < options.length; index++) {
    const argument = options[index];
    switch (argument) {
      case '--all': {
        full = true;
        break;
      }
      case '--json': {
        json = true;
        break;
      }
      case '--root': {
        const value = options[++index];
        if (!value || value.startsWith('--'))
          throw new Error('--root 需要目录');
        root = realpathSync(value);

        break;
      }
      default: {
        if (argument.startsWith('-')) throw new Error(`未知选项：${argument}`);
        else paths.push(argument);
      }
    }
  }
  const frontend = fileURLToPath(new URL('..', import.meta.url));
  const explicitRoot = root !== undefined;
  root ??= repositoryRoot(frontend);
  if (mode === 'web' && paths.length === 0)
    paths.push(explicitRoot ? '.' : relative(root, frontend));
  const extensions =
    mode === 'web'
      ? new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx', '.vue'])
      : new Set(['.md']);
  const files = discover(root, paths, extensions);
  const findings = [];
  let count = 0;
  if (mode === 'web') {
    const tracked = full ? null : trackedFiles(root);
    const changed = full ? null : changedFiles(root);
    for (const file of files) {
      if (file.endsWith('.d.ts')) continue;
      if (changed && !changed.has(relative(root, file).replaceAll('\\', '/')))
        continue;
      const request = webRequest(root, file, readText(file), tracked);
      if (request.lines && request.lines.length === 0) continue;
      count++;
      findings.push(...checkWebFile(request));
    }
  } else {
    const blocks = files.flatMap(
      /** 仓库文档与前端文档采用相同解析规则。 */ (file) =>
        mermaidBlocks(
          relative(root, file).replaceAll('\\', '/'),
          readText(file),
        ),
    );
    count = blocks.length;
    if (count) findings.push(...(await checkMermaid(blocks)));
  }
  if (json) console.log(JSON.stringify({ check: mode, count, findings }));
  else {
    for (const finding of findings)
      console.log(
        `${finding.path}:${finding.line} [${finding.rule}] ${finding.message}`,
      );
    console.log(`${mode}：检查 ${count} 项，发现 ${findings.length} 个问题`);
  }
  return findings.length > 0 ? 1 : 0;
}

// 被测试导入时不运行命令；只有直接调用才产生标准输出和进程退出状态。
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await run(process.argv.slice(2))
    .then(
      /** 规则失败须传递给 pnpm 和 CI。 */ (code) => {
        process.exitCode = code;
      },
    )
    .catch(
      /** 环境或输入失败不能计为已检查通过。 */ (error) => {
        console.error(error.message);
        process.exitCode = 2;
      },
    );
}
