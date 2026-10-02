/** 使用本工程 Mermaid 依赖检查图表语法，不渲染图片或请求外部资源。 */
/**
 * 使用 Mermaid 自身解析图表，关闭渲染及外部资源加载。
 * @param blocks - 前端命令或 Python 入口提取的真实 Markdown Mermaid 围栏。
 * @returns 语法问题列表，保持原文件正文起始行号。
 */
export async function checkMermaid(blocks) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('');
  Object.defineProperty(globalThis, 'window', {
    value: dom.window,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: dom.window.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  const findings = [];
  try {
    for (const block of blocks) {
      try {
        await mermaid.parse(block.source, { suppressErrors: false });
      } catch (error) {
        findings.push({
          path: block.path,
          line: block.line,
          rule: 'mermaid-syntax',
          message: String(error.message ?? error).replaceAll(/\s+/gu, ' '),
        });
      }
    }
  } finally {
    dom.window.close();
  }
  return findings;
}
