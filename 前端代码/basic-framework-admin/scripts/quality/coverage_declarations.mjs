/**
 * 用真实 TypeScript/Vue AST 确认零计数文件仅含声明；不以文件名判断可执行性。
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

import { parse } from '@vue/compiler-sfc';

import ts from 'typescript';

/**
 * 判断单个顶层声明是否不会产生需要覆盖的实现体。
 * @param {import('typescript').Statement} statement 已成功解析的顶层语句。
 * @returns {boolean} 类型声明、导入导出和显式 ambient 声明返回 true。
 */
function declarationOnly(statement) {
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isImportDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  ) {
    return true;
  }
  if (ts.canHaveModifiers(statement)) {
    for (const item of ts.getModifiers(statement) ?? []) {
      if (item.kind === ts.SyntaxKind.DeclareKeyword) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 确认文件没有实现体；Vue 模板本身有运行时渲染行为，不能凭缺少 script 豁免。
 * @param {string} filename 待核对的绝对源码路径。
 * @returns {boolean} 解析成功且所有顶层语句无实现时返回 true。
 * @throws {Error} 文件无法读取或 Vue/TypeScript 无法解析，错误信息带文件名与位置。
 */
function hasOnlyDeclarations(filename) {
  let source = readFileSync(filename, 'utf8');
  // .vue 扩展名无法让 TypeScript 推断脚本种类；lang="tsx" 必须按 TSX 解析，否则 JSX 无法解析。
  let scriptKind;
  if (filename.endsWith('.vue')) {
    const result = parse(source, { filename });
    if (result.errors.length > 0) {
      throw new Error(`Vue 源码解析失败：${filename}`);
    }
    if (result.descriptor.template?.content.trim()) {
      return false;
    }
    const lang =
      result.descriptor.script?.lang ?? result.descriptor.scriptSetup?.lang;
    if (lang === 'tsx') {
      scriptKind = ts.ScriptKind.TSX;
    } else if (lang === 'jsx') {
      scriptKind = ts.ScriptKind.JSX;
    }
    source = [
      result.descriptor.script?.content,
      result.descriptor.scriptSetup?.content,
    ]
      .filter(Boolean)
      .join('\n');
  }
  const parsed = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  if (parsed.parseDiagnostics.length > 0) {
    // 不带文件名和位置的报错无法定位，声明核对失败会直接变成门禁退出码 2。
    const diagnostic = parsed.parseDiagnostics[0];
    const { line, character } = parsed.getLineAndCharacterOfPosition(
      diagnostic.start ?? 0,
    );
    throw new Error(
      `TypeScript 源码解析失败：${filename} 第 ${line + 1} 行第 ${character + 1} 列 - ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    );
  }
  for (const statement of parsed.statements) {
    if (!declarationOnly(statement)) {
      return false;
    }
  }
  return true;
}

/**
 * 读取标准输入的全部内容。
 *
 * 不能用 `readFileSync(0)`：调用方通过管道写入上千条路径时，输入远大于管道缓冲，
 * 同步读在非阻塞管道上会间歇抛出 `EAGAIN`，让覆盖率裁决误判为“声明文件解析失败”（退出 2）。
 * 按流读取会等待写入方结束，不受缓冲大小影响。
 *
 * @returns {Promise<string>} 标准输入的 UTF-8 文本。
 */
async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const filenames = JSON.parse(await readStandardInput());
if (!Array.isArray(filenames)) {
  throw new TypeError('源码列表格式无效');
}
const declarations = [];
for (const filename of filenames) {
  if (typeof filename !== 'string') {
    throw new TypeError('源码路径必须为字符串');
  }
  if (hasOnlyDeclarations(filename)) {
    declarations.push(filename);
  }
}
process.stdout.write(JSON.stringify(declarations));
