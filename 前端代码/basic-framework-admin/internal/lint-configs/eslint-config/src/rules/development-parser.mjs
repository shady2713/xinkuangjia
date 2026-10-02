/** 离线提取 TS、JS 与 Vue 脚本的导入及配置字段，不执行被检查源码。 */
import { Buffer } from 'node:buffer';
import { builtinModules } from 'node:module';

import { parse as parseSfc } from '@vue/compiler-sfc';

import ts from 'typescript';

/**
 * 提取静态字符串；动态表达式返回空值，交给调用方报告覆盖缺口。
 * @param node - TypeScript 表达式节点。
 * @returns 静态字符串或 null。
 */
function literal(node) {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

/**
 * 按文件后缀选择解析语言，保留 JSX 与 TypeScript 语法差异。
 * @param suffix - 文件路径或 Vue 脚本语言后缀。
 * @returns TypeScript 编译器的脚本类别。
 */
function scriptKind(suffix) {
  if (suffix.endsWith('tsx')) return ts.ScriptKind.TSX;
  if (suffix.endsWith('jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:m|c)?js$/u.test(suffix)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * 提取一个文件的源码事实，诊断只包含字段及行号，不返回配置值。
 * @param file - 包含 path、source 的输入对象。
 * @returns 导入、配置位置及不能静态确定的动态导入位置。
 * @throws Vue 或 TypeScript 语法错误时拒绝部分解析。
 */
export function analyze(file) {
  const imports = [];
  const config = [];
  const dynamic = [];
  let blocks = [{ content: file.source, offset: 0, suffix: file.path }];
  if (file.path.endsWith('.vue')) {
    const parsed = parseSfc(file.source, { filename: file.path });
    if (parsed.errors.length > 0) throw new Error('Vue 语法错误');
    blocks = [parsed.descriptor.script, parsed.descriptor.scriptSetup]
      .filter(Boolean)
      .map(
        /**
         * 保留原始行偏移，避免 Vue 脚本行号从一重新开始。
         * @param block - Vue 解析器发现的脚本区块。
         * @returns 保留源码、行偏移及语言的解析输入。
         */ (block) => ({
          content: block.content,
          offset: block.loc.start.line - 1,
          suffix: `.${block.lang ?? 'js'}`,
          src: block.src,
        }),
      );
  }
  for (const block of blocks) {
    if (block.src) imports.push({ spec: block.src, line: block.offset + 1 });
    const kind = scriptKind(block.suffix);
    const tree = ts.createSourceFile(
      file.path,
      block.content,
      ts.ScriptTarget.Latest,
      true,
      kind,
    );
    if (tree.parseDiagnostics.length > 0) throw new Error('脚本语法错误');
    /**
     * 递归读取语法事实，注释和普通文本中的伪导入不会进入结果。
     * @param node - 当前遍历的语法节点，结果追加到所属文件的事实列表。
     */
    function visit(node) {
      const line =
        tree.getLineAndCharacterOfPosition(node.getStart(tree)).line +
        1 +
        block.offset;
      let specNode;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        specNode = node.moduleSpecifier;
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        specNode = node.moduleReference.expression;
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        specNode = node.argument.literal;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'))
      ) {
        specNode = node.arguments[0];
        if (literal(specNode) === null) dynamic.push(line);
      }
      const spec = literal(specNode);
      if (spec !== null) imports.push({ spec, line });
      let key;
      if (ts.isPropertyAccessExpression(node)) key = node.name.text;
      if (ts.isElementAccessExpression(node))
        key = literal(node.argumentExpression);
      if (ts.isBindingElement(node))
        key = (node.propertyName ?? node.name).text;
      if (key === 'VITE_GLOB_API_URL')
        config.push({ line, rule: 'config-owner' });
      if (ts.isPropertyAssignment(node)) {
        key = node.name.text ?? literal(node.name.expression);
        const value = literal(node.initializer);
        if (value && key === 'baseURL')
          config.push({ line, rule: 'inline-endpoint' });
        if (value && /^(?:apiKey|authToken|clientSecret)$/u.test(key ?? '')) {
          config.push({ line, rule: 'inline-credential' });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  return { path: file.path, imports, config, dynamic };
}

/**
 * 读取有界 JSON 请求并输出解析结果；协议失败返回 2，不回显源码。
 * @throws 请求过大、字段无效或源码无法解析时失败，由入口转换为退出码 2。
 */
async function main() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 32 * 1024 * 1024) throw new Error('输入超过 32 MiB');
    chunks.push(chunk);
  }
  const files = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
  );
  if (!Array.isArray(files) || files.length > 100)
    throw new Error('输入批次无效');
  const results = files.map(
    /** 校验边界字段后才允许语法解析。 */ (file) => {
      if (typeof file.path !== 'string' || typeof file.source !== 'string')
        throw new Error('文件字段无效');
      return analyze(file);
    },
  );
  process.stdout.write(
    JSON.stringify({ files: results, builtins: builtinModules }),
  );
}

if (process.argv.includes('--stdio')) {
  await main().catch(
    /** 将解析错误与规则问题区分，并避免泄露输入内容。 */ () => {
      process.stderr.write('源码解析失败，请检查输入格式与语法。\n');
      process.exitCode = 2;
    },
  );
}
