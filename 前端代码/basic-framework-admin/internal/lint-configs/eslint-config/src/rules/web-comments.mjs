/**
 * 为前端 ESLint、命令行和 Python 入口提供相同的离线检查规则。
 * 仅解析输入文本，不执行目标源码；诊断包含原始文件路径和行号。
 */
import { parse as parseSfc } from '@vue/compiler-sfc';

import ts from 'typescript';

const chinese = /[\u3400-\u9FFF]/u;

/**
 * 判断文字是否包含实际中文说明，排除仅有标签及占位词的情况。
 * @param text - 去掉注释边界后的文字。
 * @returns 是否含中文且不是独立占位说明。
 */
function meaningful(text) {
  const prose = text.replaceAll(/@\w[^\n]*/gu, '').replaceAll(/[*\s]/gu, '');
  return (
    chinese.test(prose) &&
    !/^(?:待补充|待填写|暂无|注释|说明|实现|TODO)$/iu.test(prose)
  );
}

/**
 * 去掉注释边界，保留标签正文及换行。
 * @param text - 原始连续注释。
 * @returns 适合职责和标签检查的文字。
 */
function commentText(text) {
  return text
    .replaceAll(/\/\*\*?|\*\//gu, '')
    .replaceAll(/^\s*(?:\*|\/\/) ?/gmu, '')
    .trim();
}

/**
 * 判断当前声明是否与本轮改动行相交。
 * @param file - 带增量行号的输入文件。
 * @param start - 声明或前置注释起始行。
 * @param end - 声明结束行。
 * @returns 全量检查或有行号交集时为真。
 */
function involved(file, start, end) {
  return (
    file.lines === null ||
    file.lines.some(
      /** 判断改动行是否落入声明范围。 */ (line) =>
        start <= line && line <= end,
    )
  );
}

/**
 * 获取紧邻声明的注释，阻止隔着其他语句复用旧注释。
 * @param node - 声明或承载箭头函数的语句节点。
 * @param sourceFile - TypeScript 语法树。
 * @param start - 声明起始字符位置；由调用方显式给出，便于独立复核被代码隔开的兜底判定。
 * @returns 原始注释、说明文字、起始字符及是否为 JSDoc。
 */
export function documentation(node, sourceFile, start) {
  // 参数列表中的回调注释属于同一物理行的 trivia，需同时读取 trailing 范围。
  const ranges = [
    ...(ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? []),
    ...(ts.getTrailingCommentRanges(sourceFile.text, node.getFullStart()) ??
      []),
  ].toSorted(
    /** 按源码顺序选择紧邻声明的注释。 */ (left, right) => left.pos - right.pos,
  );
  const close = ranges.filter(
    /** 只保留声明之前的注释。 */ (range) => range.end <= start,
  );
  if (close.length === 0) return { raw: '', text: '', start, jsdoc: false };
  const last = close.at(-1);
  if (sourceFile.text.slice(last.end, start).trim()) {
    return { raw: '', text: '', start, jsdoc: false };
  }
  // 只收集尾部连续注释，不把函数体内或上一个声明的说明拼入。
  let first = close.length - 1;
  while (
    first > 0 &&
    !sourceFile.text.slice(close[first - 1].end, close[first].pos).trim()
  )
    first--;
  const raw = close
    .slice(first)
    .map(
      /** 提取原始注释字符范围。 */ (range) =>
        sourceFile.text.slice(range.pos, range.end),
    )
    .join('\n');
  const parsed = commentText(raw);
  const description = parsed.replaceAll(/@description\s+/gu, '');
  return {
    raw,
    text: description,
    start: close[first].pos,
    jsdoc: raw.includes('/**'),
  };
}

/**
 * 判断类型包装节点是否不改变注释承载语义。
 * 圆括号、联合、交叉与类型运算符只是类型表达式的书写包装，自身没有可书写说明的位置：
 * 说明只能落在最外层声明之前。遇到它们必须继续向上追溯，否则承载节点会退化成函数类型
 * 自身，注释被夹在两层括号之间而无处安放。
 * 判据只覆盖类型包装：调用、二元运算等表达式节点会改变实参位置与匿名回调归并的判定，
 * 不得视为透明。
 * @param node - 当前类型节点的祖先节点。
 * @returns 是否为可继续向上追溯承载声明的类型包装节点。
 */
function typeWrapper(node) {
  return (
    ts.isParenthesizedTypeNode(node) ||
    ts.isUnionTypeNode(node) ||
    ts.isIntersectionTypeNode(node) ||
    ts.isTypeOperatorNode(node)
  );
}

/**
 * 找到箭头函数或函数表达式的职责注释承载节点。
 * @param node - 当前语法节点。
 * @returns 变量语句、属性声明或原节点。
 */
function ownerOf(node) {
  if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) {
    // 类型包装不改变承载语义：说明只能写在包装之外的最外层声明之前，
    // 因此先穿过包装，再在最外层祖先上确认承载声明。
    let outer = node.parent;
    while (outer && typeWrapper(outer)) outer = outer.parent;
    if (ts.isTypeAliasDeclaration(outer) || ts.isPropertySignature(outer))
      return outer;
  } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    // 具名函数表达式被圆括号包裹（如立即调用的清理入口）时，说明写在最外层左括号
    // 之前，圆括号是该声明的书写起点。匿名回调仍以自身节点为承载候选，否则会把
    // 实参或表达式位置的匿名回调直接归到外层声明，改变已校准的归并语义。
    let target = node;
    if (ts.isFunctionExpression(node) && node.name)
      while (ts.isParenthesizedExpression(target.parent))
        target = target.parent;
    const parent = target.parent;
    if (ts.isVariableDeclaration(parent)) {
      return ts.isVariableStatement(parent.parent.parent)
        ? parent.parent.parent
        : parent;
    }
    if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))
      return parent;
    return target;
  }
  return node;
}

/**
 * 判断匿名函数是否处在调用实参或表达式位置。
 * 这类回调不是显式方法声明，写注释的位置也不在声明之前，单独要求会让正常文档写法失效。
 * @param node - 箭头函数或函数表达式。
 * @returns 父节点是否为实参、数组元素、返回表达式等表达式位置。
 */
function expressionPosition(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent))
    return (parent.arguments ?? []).includes(node);
  return (
    ts.isArrayLiteralExpression(parent) ||
    ts.isReturnStatement(parent) ||
    ts.isConditionalExpression(parent) ||
    ts.isBinaryExpression(parent) ||
    ts.isParenthesizedExpression(parent) ||
    ts.isSpreadElement(parent) ||
    ts.isAwaitExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTemplateSpan(parent) ||
    ts.isBindingElement(parent) ||
    ts.isArrowFunction(parent) ||
    ts.isFunctionExpression(parent)
  );
}

/**
 * 向上寻找最近的具名承载声明；注释写在它的上方即可消除要求。
 * @param node - 实参或表达式位置的匿名函数。
 * @returns 变量语句、属性、方法等具名声明节点，没有时返回 undefined。
 */
function namedCarrier(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isVariableStatement(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isGetAccessor(parent) ||
      ts.isSetAccessor(parent) ||
      ts.isConstructorDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isEnumDeclaration(parent)
    )
      return parent;
  }
  return undefined;
}

/**
 * 判断声明是否公开，接口成员和非私有类方法需要完整调用契约。
 * @param node - 待检查声明。
 * @param owner - 注释承载节点。
 * @returns 是否要求 JSDoc 和适用的参数、返回标签。
 */
function publicDeclaration(node, owner) {
  if ((ts.getCombinedModifierFlags(owner) & ts.ModifierFlags.Export) !== 0)
    return true;
  if (
    ts.isMethodSignature(node) ||
    ts.isCallSignatureDeclaration(node) ||
    ts.isConstructSignatureDeclaration(node)
  )
    return true;
  if (node.parent && ts.isInterfaceDeclaration(node.parent)) return true;
  if (
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node)
  ) {
    return (
      !(
        ts.getCombinedModifierFlags(node) &
        (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
      ) && !(node.name && ts.isPrivateIdentifier(node.name))
    );
  }
  return false;
}

/**
 * 扫描函数自身控制流；嵌套函数的返回和异常属于其自己的契约。
 * @param node - 函数式声明。
 * @returns 返回值、直接抛异常及控制流分支数量。
 */
function bodyFacts(node) {
  const facts = { returns: false, throws: false, branches: 0 };
  if (!node.body) return facts;
  if (!ts.isBlock(node.body)) facts.returns = !ts.isVoidExpression(node.body);
  /**
   * 访问同一函数的控制流节点，遇到嵌套函数时停止向下。
   * @param child - 正在访问的语法子节点。
   */
  function visit(child) {
    if (child !== node && ts.isFunctionLike(child)) return;
    if (
      ts.isReturnStatement(child) &&
      child.expression &&
      child.expression.kind !== ts.SyntaxKind.UndefinedKeyword
    )
      facts.returns = true;
    if (ts.isThrowStatement(child)) {
      let parent = child.parent;
      let caught = false;
      while (parent && parent !== node) {
        if (
          ts.isTryStatement(parent) &&
          parent.catchClause &&
          child.pos >= parent.tryBlock.pos &&
          child.end <= parent.tryBlock.end
        )
          caught = true;
        parent = parent.parent;
      }
      if (!caught) facts.throws = true;
    }
    if (
      ts.isIfStatement(child) ||
      ts.isConditionalExpression(child) ||
      ts.isForStatement(child) ||
      ts.isForOfStatement(child) ||
      ts.isForInStatement(child) ||
      ts.isWhileStatement(child) ||
      ts.isSwitchStatement(child) ||
      ts.isCatchClause(child)
    )
      facts.branches++;
    ts.forEachChild(child, visit);
  }
  visit(node.body);
  return facts;
}

/**
 * 判断函数是否声明或明显返回非空值；不把空 Promise 强行标为有返回内容。
 * @param node - 函数式声明。
 * @param facts - 函数自身的控制流事实。
 * @param sourceFile - 当前语法树。
 * @returns 是否要求返回说明。
 */
function hasReturn(node, facts, sourceFile) {
  if (ts.isConstructorDeclaration(node) || ts.isSetAccessor(node)) return false;
  if (node.type) {
    const text = node.type.getText(sourceFile).replaceAll(/\s/gu, '');
    return !/^(?:void|undefined|never|Promise<(?:void|undefined|never)>)$/u.test(
      text,
    );
  }
  return facts.returns;
}

/**
 * 提取参数标签并保留字段路径，支持类型标记和可选参数写法。
 * @param text - 注释文字。
 * @returns 参数名到说明的映射。
 */
function parameterTags(text) {
  const tags = new Map();
  for (const match of text.matchAll(
    /@param\s+(?:\{[^}]*\}\s*)?(\[[^\]]+\]|\S+)\s*([^@]*)/gu,
  )) {
    const name = match[1].replaceAll(/^\[|\]$/gu, '').split('=')[0];
    tags.set(name, match[2].replace(/^\s*-\s*/u, '').trim());
  }
  return tags;
}

/**
 * 按完整诊断键去重：同一承载声明会被变量语句与函数表达式两条路径各裁决一次，
 * 参数标签也会按每个参数各报一次，重复行会让调用方误以为存在多个问题。
 * 只有路径、行号、规则码与文案完全一致时才合并，不同规则或不同行的诊断均保留。
 * @param findings - 检查产出的诊断列表。
 * @returns 按出现顺序保留首条的诊断列表。
 */
function dedupe(findings) {
  const seen = new Set();
  return findings.filter(
    /** 完整诊断键重复时丢弃后出现的一条。 */ (finding) => {
      const key = `${finding.path}\n${finding.line}\n${finding.rule}\n${finding.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  );
}

/**
 * 提取脚本块之前的中文 HTML 注释，作为 Vue 组件模块头的说明来源。
 * @param source - Vue 单文件组件原文。
 * @param scriptStart - 第一个脚本块在原文中的起始字符位置。
 * @returns 拼接后的 HTML 注释原文；没有脚本块时返回空串。
 */
function htmlHeader(source, scriptStart) {
  if (scriptStart === null) return '';
  return [...source.slice(0, scriptStart).matchAll(/<!--[\s\S]*?-->/gu)]
    .map(/** 保留注释原文交给统一的中文说明判据。 */ (match) => match[0])
    .join('\n');
}

/**
 * 解析一个脚本块并检查受改动影响的显式声明。
 * @param file - Python 提供的文件及改动行。
 * @param source - JS 或 TS 脚本块原文。
 * @param offset - 脚本块之前的文件行数。
 * @param language - ts、tsx、js 或 jsx。
 * @param header - 脚本块之前的 HTML 注释，Vue 组件用它承载模块头说明。
 * @returns 可直接交给 Python 输出的诊断列表。
 */
function checkScript(file, source, offset, language, header = '') {
  const kind =
    {
      ts: ts.ScriptKind.TS,
      tsx: ts.ScriptKind.TSX,
      jsx: ts.ScriptKind.JSX,
      js: ts.ScriptKind.JS,
    }[language] ?? ts.ScriptKind.TS;
  const tree = ts.createSourceFile(
    file.path,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const findings = [];
  /** 把字符位置转换为原始文件行号并追加规则诊断。 */
  function fail(position, rule, message) {
    const line =
      tree.getLineAndCharacterOfPosition(Math.max(0, position)).line +
      offset +
      1;
    findings.push({ path: file.path, line, rule, message });
  }
  for (const diagnostic of tree.parseDiagnostics) {
    fail(
      diagnostic.start ?? 0,
      'web-syntax',
      ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    );
  }
  if (tree.parseDiagnostics.length > 0) return findings;
  const first = tree.statements[0];
  if (
    first &&
    (file.new ||
      involved(
        file,
        offset + 1,
        offset +
          tree.getLineAndCharacterOfPosition(first.getStart(tree)).line +
          1,
      ))
  ) {
    const doc = documentation(first, tree, first.getStart(tree));
    // 脚本块之前的 HTML 注释与无脚本组件的判据保持一致：都是同一份中文组件说明。
    if (!meaningful(doc.text) && !meaningful(header))
      fail(0, 'web-module-doc', '模块或组件顶部缺少中文职责说明');
  }
  /**
   * 检查语法节点的职责及可机械核验的公开调用契约。
   * @param node - 当前声明或其所属子树节点。
   */
  function visit(node) {
    const callable =
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node) ||
      ts.isMethodSignature(node) ||
      ts.isCallSignatureDeclaration(node) ||
      ts.isConstructSignatureDeclaration(node) ||
      ts.isFunctionTypeNode(node) ||
      ts.isConstructorTypeNode(node);
    const structure =
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node);
    const publicVariable =
      ts.isVariableStatement(node) &&
      (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
    if (callable || structure || publicVariable) {
      let owner = ownerOf(node);
      // 实参或表达式位置的匿名回调不是显式方法：要求归并到最近的具名承载声明，
      // 由承载声明承担职责说明；没有具名承载声明时它不作为独立声明被要求。
      let merged = false;
      let unnamedCallback = false;
      if (
        callable &&
        owner === node &&
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        !node.name &&
        expressionPosition(node)
      ) {
        unnamedCallback = true;
        // 回调自带紧邻的中文说明时要求已经满足，既不归并也不追加契约标签。
        if (!meaningful(documentation(node, tree, node.getStart(tree)).text)) {
          const carrier = namedCarrier(node);
          if (carrier) {
            owner = carrier;
            merged = true;
          }
        }
      }
      if (!unnamedCallback || merged) {
        const doc = documentation(owner, tree, owner.getStart(tree));
        const start =
          tree.getLineAndCharacterOfPosition(doc.start).line + offset + 1;
        // 类或接口只检查头部，内部方法的改动由方法自身承担，避免把旧类注释一并阻断。
        const endPosition = structure
          ? (node.members?.pos ?? node.getStart(tree))
          : owner.end;
        const end =
          tree.getLineAndCharacterOfPosition(endPosition).line + offset + 1;
        if (involved(file, start, end)) {
          const named = merged ? owner : node;
          const label =
            named.name?.getText(tree) ??
            (ts.isConstructorDeclaration(named) ? 'constructor' : '函数或声明');
          const position = merged ? owner.getStart(tree) : node.getStart(tree);
          // 函数类型被类型包装与承载声明隔开时，它只是该类型表达式的一个分支：
          // 说明由承载声明的注释整体承担，但公开性仍按分支自身裁决，承载声明的导出
          // 标记不转化为对单个分支的 JSDoc 与契约标签要求（包装上提只改说明的落点）。
          const branched = callable && typeWrapper(node.parent);
          const isPublic = !branched && publicDeclaration(node, owner);
          if (!meaningful(doc.text)) {
            fail(position, 'web-doc', `${label} 缺少中文职责注释`);
          } else if (isPublic && !doc.jsdoc) {
            fail(position, 'web-jsdoc', `${label} 公开声明需要 JSDoc 块注释`);
          }
          // 归并到承载声明后，参数与返回标签属于该回调自身，不再按它的签名裁决。
          if (callable && !merged) {
            const facts = bodyFacts(node);
            const contract = isPublic || facts.branches >= 2;
            if (contract) {
              const tags = parameterTags(doc.text);
              const parameters = (node.parameters ?? []).filter(
                /** this 类型参数不是调用方传入的参数。 */ (parameter) =>
                  parameter.name.getText(tree) !== 'this',
              );
              for (const parameter of parameters) {
                if (ts.isIdentifier(parameter.name)) {
                  if (!meaningful(tags.get(parameter.name.text) ?? '')) {
                    fail(
                      parameter.getStart(tree),
                      'web-param',
                      `${label} 缺少参数 ${parameter.name.text} 的中文说明`,
                    );
                  }
                } else {
                  // 解构参数允许一个具名对象标签；字段语义是否完整仍需人工复核。
                  if (
                    ![...tags.values()].some(
                      /** 解构参数至少要有实际对象说明。 */ (value) =>
                        meaningful(value),
                    )
                  )
                    fail(
                      parameter.getStart(tree),
                      'web-param',
                      `${label} 解构参数缺少中文说明`,
                    );
                }
              }
              const simpleNames = new Set(
                parameters
                  .filter(
                    /** 仅具名参数可以精确匹配标签名。 */ (p) =>
                      ts.isIdentifier(p.name),
                  )
                  .map(/** 提取实际参数标识符。 */ (p) => p.name.text),
              );
              if (
                parameters.every(
                  /** 解构签名不能按直接参数名检查过期标签。 */ (p) =>
                    ts.isIdentifier(p.name),
                )
              ) {
                for (const key of tags.keys()) {
                  if (!simpleNames.has(key.split('.')[0]))
                    fail(
                      node.getStart(tree),
                      'web-param-stale',
                      `${label} 包含签名中不存在的参数标签：${key}`,
                    );
                }
              }
              const returns = /@returns?\s+([^@]*)/u.exec(doc.text)?.[1] ?? '';
              if (hasReturn(node, facts, tree) && !meaningful(returns)) {
                fail(
                  node.getStart(tree),
                  'web-returns',
                  `${label} 缺少返回结果的中文说明`,
                );
              }
              const throws =
                /@(?:throws|exception)\s+([^@]*)/u.exec(doc.text)?.[1] ?? '';
              if (facts.throws && !meaningful(throws)) {
                fail(
                  node.getStart(tree),
                  'web-throws',
                  `${label} 存在直接抛出异常，需要中文失败条件说明`,
                );
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return findings;
}

/**
 * 解析 Vue SFC 并保持原文件行号；模板语法由 Vue 解析器负责。
 * @param file - 带原始源码和增量行号的输入文件。
 * @returns Vue 语法问题及脚本块中的注释问题。
 */
export function checkWebFile(file) {
  if (!file.path.endsWith('.vue')) {
    const extension = file.path.split('.').at(-1);
    return dedupe(
      checkScript(
        file,
        file.source,
        0,
        ['js', 'jsx', 'tsx'].includes(extension) ? extension : 'ts',
      ),
    );
  }
  const result = parseSfc(file.source, {
    filename: file.path,
    sourceMap: false,
  });
  const findings = result.errors.map(
    /** 将 Vue 错误映射为统一诊断，不丢失原文件行号。 */ (error) => ({
      path: file.path,
      line: error.loc?.start?.line ?? 1,
      rule: 'vue-syntax',
      message: typeof error === 'string' ? error : error.message,
    }),
  );
  if (findings.length > 0) return findings;
  const blocks = [
    result.descriptor.script,
    result.descriptor.scriptSetup,
  ].filter(Boolean);
  const scripts = blocks.filter(
    /** 外置脚本由对应文件检查，不参与正文行号与模块头判据。 */ (block) =>
      !block.src,
  );
  /** 脚本块之前的中文 HTML 注释是组件的模块头说明来源。 */
  const header = htmlHeader(
    file.source,
    scripts.length > 0
      ? Math.min(
          /** 取第一个内联脚本块起点，HTML 注释必须写在它之前。 */ ...scripts.map(
            (block) => block.loc.start.offset,
          ),
        )
      : null,
  );
  for (const block of scripts) {
    findings.push(
      ...checkScript(
        file,
        block.content,
        block.loc.start.line - 1,
        block.lang ?? 'js',
        header,
      ),
    );
  }
  if (
    blocks.length === 0 &&
    file.new &&
    ![...file.source.matchAll(/<!--[\s\S]*?-->/gu)].some(
      /** 完整 HTML 注释中的中文才属于组件说明。 */ (match) =>
        chinese.test(match[0]),
    )
  ) {
    findings.push({
      path: file.path,
      line: 1,
      rule: 'vue-component-doc',
      message: '无脚本组件缺少中文职责说明',
    });
  }
  return dedupe(findings);
}
