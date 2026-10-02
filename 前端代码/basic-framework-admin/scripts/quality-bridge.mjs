/** 为仓库 Python 入口提供有大小限制的 JSON 协议，复用前端检查规则。 */
import { Buffer } from 'node:buffer';

import { checkWebFile } from '../internal/lint-configs/eslint-config/src/rules/web-comments.mjs';
import { checkMermaid } from './mermaid-parser.mjs';

/**
 * 读取并验证文本请求；依赖、协议或输入失败通过退出码 2 报告。
 * @returns 结果写入标准输出，没有业务返回值。
 * @throws 输入超过限制或请求字段无效时拒绝解析。
 */
async function main() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new Error('解析请求超过 32 MiB');
    chunks.push(chunk);
  }
  const request = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
  );
  let findings;
  if (request.mode === 'web' && Array.isArray(request.files)) {
    for (const file of request.files) {
      if (
        typeof file.path !== 'string' ||
        typeof file.source !== 'string' ||
        typeof file.new !== 'boolean' ||
        !(
          file.lines === null ||
          (Array.isArray(file.lines) &&
            file.lines.every(
              /** 行号必须为正整数，不能通过负值绕过范围检查。 */ (line) =>
                Number.isInteger(line) && line > 0,
            ))
        )
      )
        throw new Error('Web 解析请求结构不正确');
    }
    findings = request.files.flatMap(
      /** 分别解析请求中的源码，不执行源码。 */ (file) => checkWebFile(file),
    );
  } else if (request.mode === 'mermaid' && Array.isArray(request.blocks)) {
    for (const block of request.blocks) {
      if (
        typeof block.path !== 'string' ||
        typeof block.source !== 'string' ||
        !Number.isInteger(block.line) ||
        block.line < 1
      )
        throw new Error('Mermaid 解析请求结构不正确');
    }
    findings = await checkMermaid(request.blocks);
  } else {
    throw new Error('未知解析模式或请求结构不正确');
  }
  process.stdout.write(JSON.stringify({ findings }));
}

await main().catch(
  /** 协议或环境异常不能伪装成检查通过。 */ (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  },
);
