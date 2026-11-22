import { readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const workspaceRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const appRoot = join(workspaceRoot, 'apps', 'web-ele');
const sourceRoots = [join(appRoot, 'src'), join(workspaceRoot, 'packages')];
const distRoot = join(appRoot, 'dist');
const sourceOnly = process.argv.includes('--source-only');

/** 单个生产 JS chunk 原始字节上限（1.2 MB），防止回归巨型单包。 */
const MAX_JS_CHUNK_BYTES = 1_200_000;

const ALLOWED_WINDOW_OPEN_FILES = new Set([
  'packages/@core/base/shared/src/utils/__tests__/window.test.ts',
  'packages/@core/base/shared/src/utils/window.ts',
]);

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue']);
const ARTIFACT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.mjs',
  '.txt',
]);

/**
 * 扫描源码和生产产物中的高风险残留与体积预算回归。
 *
 * @returns 无风险时正常退出；发现问题时抛出异常并由 CI 阻断发布
 * @throws 检测到高风险用法、开发配置残留或超体积预算时抛出异常
 */
async function main() {
  const findings = [];
  for (const sourceRoot of sourceRoots) {
    for (const file of await collectFiles(sourceRoot, SOURCE_EXTENSIONS)) {
      const relPath = displayPath(file);
      const content = await readFile(file, 'utf8');
      if (
        /\bnew\s+Function\s*\(/u.test(content) ||
        /\beval\s*\(/u.test(content)
      ) {
        findings.push(`${relPath}：包含动态 JavaScript 执行`);
      }
      if (/\bv-html\s*=/u.test(content)) {
        findings.push(`${relPath}：包含未经统一净化约束的 v-html`);
      }
      if (/\bdangerouslyUseHTMLString\b/u.test(content)) {
        findings.push(
          `${relPath}：禁止使用 dangerouslyUseHTMLString，请改用 Vue VNode`,
        );
      }
      if (
        !ALLOWED_WINDOW_OPEN_FILES.has(relPath) &&
        /\bwindow\.open\s*\(/u.test(content)
      ) {
        findings.push(
          `${relPath}：禁止直接调用 window.open，请改用 @vben/utils 的 openWindow`,
        );
      }
      if (
        !relPath.includes('/__tests__/') &&
        !relPath.endsWith('.test.ts') &&
        !relPath.endsWith('.spec.ts') &&
        /\.(?:innerHTML|outerHTML)\s*=|\.insertAdjacentHTML\s*\(|\bdocument\.write\s*\(/u.test(
          content,
        )
      ) {
        findings.push(
          `${relPath}：禁止直接操作 innerHTML/outerHTML/insertAdjacentHTML/document.write，请改用安全模板或 VNode`,
        );
      }
      if (
        relPath.startsWith('apps/') &&
        /\bimport\.meta\.env\.VITE_APP_(?:API_ENCRYPT_|DEFAULT_|STORE_SECURE_KEY)/u.test(
          content,
        )
      ) {
        findings.push(
          `${relPath}：禁止在应用源码直接读取构建期加密、存储密钥或默认凭据环境变量，请通过 @vben/hooks 运行时配置读取`,
        );
      }
    }
  }

  validateProductionConfiguration(findings);
  if (!sourceOnly) {
    await validateProductionArtifacts(findings);
  }

  if (findings.length > 0) {
    throw new Error(`生产安全扫描失败：\n${findings.join('\n')}`);
  }
  console.log(sourceOnly ? '源码安全扫描通过' : '生产配置及产物安全扫描通过');
}

/** 递归收集指定扩展名的文件，忽略依赖和构建缓存。 */
async function collectFiles(directory, extensions) {
  const result = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return result;
    }
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectFiles(path, extensions)));
    } else if (extensions.has(extname(entry.name))) {
      result.push(path);
    }
  }
  return result;
}

/**
 * 校验生产构建参数和运行时默认配置不会携带开发地址或预填密码。
 *
 * @param findings 收集扫描问题的数组
 */
function validateProductionConfiguration(findings) {
  const production = readEnvFile(join(appRoot, '.env.production'));
  const common = readEnvFile(join(appRoot, '.env'));
  const merged = { ...common, ...production };
  if (/localhost|127\.0\.0\.1/iu.test(merged.VITE_GLOB_API_URL ?? '')) {
    findings.push(
      'apps/web-ele/.env.production：VITE_GLOB_API_URL 指向本机地址',
    );
  }

  const runtimeConfigPath = join(appRoot, 'docker', 'app.config.js');
  const runtimeConfig = requireText(runtimeConfigPath);
  validateRuntimeConfigContent(
    runtimeConfig,
    'apps/web-ele/docker/app.config.js',
    findings,
  );
}

/**
 * 校验生产运行时配置脚本中的关键安全字段，显式区分缺失字段、合法空值与解析失败。
 *
 * @param content 运行时配置 JS 源码文本
 * @param displayFile 用于错误报告的相对文件路径
 * @param findings 收集扫描问题的数组
 */
function validateRuntimeConfigContent(content, displayFile, findings) {
  const parsed = inspectRuntimeConfigSource(content);
  if (!parsed.ok) {
    findings.push(`${displayFile}：运行时配置解析失败（${parsed.reason}）`);
    return;
  }
  for (const structuralError of parsed.structuralErrors) {
    findings.push(`${displayFile}：运行时配置结构不合法（${structuralError}）`);
  }

  const apiField = readRuntimeConfigField(parsed, 'VITE_GLOB_API_URL');
  if (apiField.status === 'missing') {
    findings.push(`${displayFile}：缺少必填字段 VITE_GLOB_API_URL`);
  } else if (apiField.status === 'invalid') {
    findings.push(
      `${displayFile}：字段 VITE_GLOB_API_URL 解析失败（${apiField.reason}）`,
    );
  } else if (!apiField.value.trim()) {
    findings.push(`${displayFile}：字段 VITE_GLOB_API_URL 不能为空`);
  } else if (/localhost|127\.0\.0\.1/iu.test(apiField.value)) {
    findings.push(`${displayFile}：默认 API 地址指向本机`);
  }

  validateRequiredEmptyField(
    parsed,
    'VITE_APP_DEFAULT_USERNAME',
    '不应预填登录用户名',
    displayFile,
    findings,
  );
  validateRequiredEmptyField(
    parsed,
    'VITE_APP_DEFAULT_PASSWORD',
    '不应预填登录密码',
    displayFile,
    findings,
  );
  for (const [fieldName, reason] of [
    ['VITE_APP_STORE_SECURE_KEY', '不应预填本地存储加密密钥'],
    ['VITE_APP_API_ENCRYPT_REQUEST_KEY', '不应预填接口请求加密密钥'],
    ['VITE_APP_API_ENCRYPT_RESPONSE_KEY', '不应预填接口响应解密密钥'],
  ]) {
    if (parsed.fields.has(fieldName)) {
      validateRequiredEmptyField(
        parsed,
        fieldName,
        reason,
        displayFile,
        findings,
      );
    }
  }
}

/**
 * 校验必须在运行时配置中显式声明为空字符串字面量的字段。
 *
 * 缺失字段、非静态字符串字面量或非空值均视为失败；仅显式空字符串（`''`）通过。
 *
 * @param parsed 静态解析后的运行时配置结果
 * @param key 字段名
 * @param nonEmptyMessage 非空时输出的阻断信息
 * @param displayFile 相对文件路径
 * @param findings 收集扫描问题的数组
 */
function validateRequiredEmptyField(
  parsed,
  key,
  nonEmptyMessage,
  displayFile,
  findings,
) {
  const field = readRuntimeConfigField(parsed, key);
  if (field.status === 'missing') {
    findings.push(`${displayFile}：缺少必填字段 ${key}`);
    return;
  }
  if (field.status === 'invalid') {
    findings.push(`${displayFile}：字段 ${key} 解析失败（${field.reason}）`);
    return;
  }
  if (field.value.trim()) {
    findings.push(`${displayFile}：${nonEmptyMessage}`);
  }
}

/**
 * 检查构建产物中的开发服务器地址、危险动态执行残留与单包体积预算。
 *
 * @param findings 收集扫描发现的问题，供主流程统一阻断发布
 * @returns 扫描结束后完成；问题追加到 findings
 */
async function validateProductionArtifacts(findings) {
  const artifactFiles = await collectFiles(distRoot, ARTIFACT_EXTENSIONS);
  if (artifactFiles.length === 0) {
    findings.push('apps/web-ele/dist：未找到生产构建产物');
    return;
  }
  const development = readEnvFile(join(appRoot, '.env.development'));
  // 开发和生产可共用 /admin-api 等同源路径；只有携带主机的开发 URL 才属于地址泄漏。
  // 同时覆盖 http(s) 与省略协议的 //host 写法，不因相对路由相同而误阻断离线发布。
  const forbiddenValues = [development.VITE_GLOB_API_URL].filter(
    (value) => value && /^(?:https?:)?\/\//iu.test(value),
  );

  let hasRuntimeConfigArtifact = false;
  for (const file of artifactFiles) {
    const ext = extname(file);
    if (ext === '.js' || ext === '.mjs') {
      const fileStat = await stat(file);
      if (fileStat.size > MAX_JS_CHUNK_BYTES) {
        findings.push(
          `${displayPath(file)}：单 chunk 体积 ${fileStat.size} bytes 超过上限 ${MAX_JS_CHUNK_BYTES} bytes`,
        );
      }
    }
    const content = await readFile(file, 'utf8');
    if (displayPath(file) === 'apps/web-ele/dist/_app.config.js') {
      hasRuntimeConfigArtifact = true;
      validateRuntimeConfigContent(content, displayPath(file), findings);
    }
    if (ext === '.html') {
      const hasInlineScript = [
        ...content.matchAll(/<script\b([^>]*)>/giu),
      ].some(
        /** 检查 script 开始标签属性列表是否缺少外部 src 引用的外链属性。 */
        ([, attrs]) => !/\bsrc\s*=/iu.test(attrs ?? ''),
      );
      if (hasInlineScript) {
        findings.push(
          `${displayPath(file)}：禁止输出无 src 的内联 script 标签，以保持严格 CSP script-src 'self'`,
        );
      }
    }
    // 第三方依赖可能包含受控的动态构造；这里只阻断本次漏洞字段和动态执行在同一代码片段中出现。
    if (
      /new\s+Function[\s\S]{0,400}parseFunc|parseFunc[\s\S]{0,400}new\s+Function/u.test(
        content,
      )
    ) {
      findings.push(`${displayPath(file)}：产物仍包含 parseFunc 动态执行路径`);
    }
    if (forbiddenValues.some((value) => content.includes(value))) {
      findings.push(`${displayPath(file)}：产物包含开发地址或预填凭证`);
    }
  }
  if (!hasRuntimeConfigArtifact) {
    findings.push(
      'apps/web-ele/dist/_app.config.js：生产产物缺少运行时配置文件',
    );
  }
}

/**
 * 格式化输出相对前端工作区根目录的路径。
 *
 * @param path 目标文件绝对路径
 * @returns 斜杠归一化的工作区相对路径
 */
function displayPath(path) {
  return relative(workspaceRoot, path).replaceAll('\\', '/');
}

/**
 * 静态解析运行时配置脚本中的 `window._VBEN_ADMIN_PRO_APP_CONF_` 对象字面量，不执行脚本。
 *
 * 使用 TypeScript JavaScript 语法解析器检查语法错误、赋值目标唯一性、重复键与字段类型，
 * 避免正则在字段删除、非字符串表达式或语法损坏时静默回退为空字符串。
 *
 * @param content 运行时配置 JS 源码文本
 * @returns 结构化解析结果，区分语法/结构失败与各字段的静态字符串字面量
 */
function inspectRuntimeConfigSource(content) {
  const sourceFile = ts.createSourceFile(
    'app.config.js',
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = sourceFile.parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    const message = ts.flattenDiagnosticMessageText(
      parseDiagnostics[0].messageText,
      ' ',
    );
    return {
      fields: new Map(),
      ok: false,
      reason: `JavaScript 语法错误：${message}`,
      status: 'parse_error',
      structuralErrors: [],
    };
  }

  const assignments = [];
  const mutationErrors = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isBinaryExpression(statement.expression) ||
      statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    ) {
      continue;
    }
    if (isAppConfigTarget(statement.expression.left)) {
      assignments.push(statement.expression.right);
    } else if (isAppConfigMemberTarget(statement.expression.left)) {
      mutationErrors.push(
        '禁止在顶层对象字面量赋值后额外修改 window._VBEN_ADMIN_PRO_APP_CONF_ 属性',
      );
    }
  }

  if (assignments.length === 0) {
    return {
      fields: new Map(),
      ok: false,
      reason: '未找到 window._VBEN_ADMIN_PRO_APP_CONF_ 顶层赋值',
      status: 'parse_error',
      structuralErrors: [],
    };
  }
  if (assignments.length > 1) {
    return {
      fields: new Map(),
      ok: false,
      reason: '存在多处 window._VBEN_ADMIN_PRO_APP_CONF_ 赋值',
      status: 'parse_error',
      structuralErrors: [],
    };
  }

  const rhs = unwrapParenthesized(assignments[0]);
  if (!ts.isObjectLiteralExpression(rhs)) {
    return {
      fields: new Map(),
      ok: false,
      reason: 'window._VBEN_ADMIN_PRO_APP_CONF_ 必须赋值为静态对象字面量',
      status: 'parse_error',
      structuralErrors: [],
    };
  }

  const fields = new Map();
  const structuralErrors = [...mutationErrors];
  for (const prop of rhs.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      structuralErrors.push('对象字面量仅允许静态键值属性，禁止展开或简写属性');
      continue;
    }
    const key = readStaticPropertyName(prop.name);
    if (key === null) {
      structuralErrors.push('存在无法静态解析的计算属性名');
      continue;
    }
    if (fields.has(key)) {
      structuralErrors.push(`存在重复配置字段 ${key}`);
      continue;
    }
    const initializer = unwrapParenthesized(prop.initializer);
    if (
      ts.isStringLiteral(initializer) ||
      ts.isNoSubstitutionTemplateLiteral(initializer)
    ) {
      fields.set(key, { status: 'ok', value: initializer.text });
    } else {
      fields.set(key, {
        reason: '字段值必须是静态字符串字面量，不能是变量、拼接或动态表达式',
        status: 'invalid',
      });
    }
  }

  return {
    fields,
    ok: true,
    reason: '',
    status: 'ok',
    structuralErrors,
  };
}

/**
 * 从已解析的运行时配置中读取指定字段，显式区分缺失、解析失败与合法字符串值。
 *
 * @param parsed `inspectRuntimeConfigSource` 返回的解析结果
 * @param key 目标字段名
 * @returns `{ status: 'ok', value }`、`{ status: 'missing', reason }` 或 `{ status: 'invalid', reason }`
 */
function readRuntimeConfigField(parsed, key) {
  if (!parsed.ok) {
    return { reason: parsed.reason, status: 'invalid' };
  }
  if (!parsed.fields.has(key)) {
    return { reason: `缺少必填字段 ${key}`, status: 'missing' };
  }
  return parsed.fields.get(key);
}

/**
 * 判断赋值左值是否为 `window._VBEN_ADMIN_PRO_APP_CONF_` 或 `globalThis._VBEN_ADMIN_PRO_APP_CONF_`。
 *
 * @param node 赋值表达式左值 AST 节点
 * @returns 匹配运行时配置全局属性时返回 true
 */
function isAppConfigTarget(node) {
  const target = unwrapParenthesized(node);
  if (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === '_VBEN_ADMIN_PRO_APP_CONF_' &&
    ts.isIdentifier(target.expression) &&
    (target.expression.text === 'window' ||
      target.expression.text === 'globalThis')
  ) {
    return true;
  }
  if (
    ts.isElementAccessExpression(target) &&
    ts.isIdentifier(target.expression) &&
    (target.expression.text === 'window' ||
      target.expression.text === 'globalThis') &&
    target.argumentExpression &&
    ts.isStringLiteral(target.argumentExpression) &&
    target.argumentExpression.text === '_VBEN_ADMIN_PRO_APP_CONF_'
  ) {
    return true;
  }
  return false;
}

/**
 * 判断赋值左值是否为 `window._VBEN_ADMIN_PRO_APP_CONF_` 的属性或下标改写。
 *
 * @param node 赋值表达式左值 AST 节点
 * @returns 命中运行时配置成员改写时返回 true
 */
function isAppConfigMemberTarget(node) {
  const target = unwrapParenthesized(node);
  if (
    ts.isPropertyAccessExpression(target) ||
    ts.isElementAccessExpression(target)
  ) {
    return isAppConfigTarget(target.expression);
  }
  return false;
}

/**
 * 提取对象字面量属性的静态名称；动态计算属性返回 null。
 *
 * @param name 属性名 AST 节点
 * @returns 静态键名或 null
 */
function readStaticPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return null;
}

/**
 * 去除外层括号表达式以获取实际语义节点。
 *
 * @param node 任意表达式 AST 节点
 * @returns 去括号后的最内层表达式节点
 */
function unwrapParenthesized(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** 同步读取简单 KEY=VALUE 环境文件，避免在扫描日志中输出配置值。 */
function readEnvFile(path) {
  const content = requireText(path);
  return Object.fromEntries(
    content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const key = line.slice(0, separator).trim();
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/u, '$2');
        return [key, value];
      }),
  );
}

/** 环境文件在质量门禁启动前必须存在，因此读取失败直接阻断。 */
function requireText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`无法读取质量门禁配置 ${displayPath(path)}`, {
      cause: error,
    });
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  await main();
}

export {
  inspectRuntimeConfigSource,
  readRuntimeConfigField,
  validateRuntimeConfigContent,
};
