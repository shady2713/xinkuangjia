/**
 * 生产安全门禁：扫描 apps/web-ele/src 与 packages 源码、生产产物及运行时配置，
 * 阻断 eval/new Function 动态执行、未净化 v-html、开发地址和预填密码。
 *
 * 加 --source-only 时跳过 dist 产物校验；发现风险即抛错让 CI 失败，
 * 只报告问题，不修改任何被扫描文件。
 */
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const appRoot = join(workspaceRoot, 'apps', 'web-ele');
const sourceRoots = [join(appRoot, 'src'), join(workspaceRoot, 'packages')];
const distRoot = join(appRoot, 'dist');
const sourceOnly = process.argv.includes('--source-only');

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
 * 扫描源码和生产产物中的高风险残留。
 *
 * @return 无风险时正常退出；发现问题时抛出异常并由 CI 阻断发布
 */
async function main() {
  const findings = [];
  for (const sourceRoot of sourceRoots) {
    for (const file of await collectFiles(sourceRoot, SOURCE_EXTENSIONS)) {
      const content = await readFile(file, 'utf8');
      if (
        /\bnew\s+Function\s*\(/u.test(content) ||
        /\beval\s*\(/u.test(content)
      ) {
        findings.push(`${displayPath(file)}：包含动态 JavaScript 执行`);
      }
      if (/\bv-html\s*=/u.test(content)) {
        findings.push(`${displayPath(file)}：包含未经统一净化约束的 v-html`);
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

/** 校验生产构建参数和运行时默认配置不会携带开发地址或预填密码。 */
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
  const apiURL = readJavaScriptStringField(runtimeConfig, 'VITE_GLOB_API_URL');
  const defaultPassword = readJavaScriptStringField(
    runtimeConfig,
    'VITE_APP_DEFAULT_PASSWORD',
  );
  if (/localhost|127\.0\.0\.1/iu.test(apiURL)) {
    findings.push('apps/web-ele/docker/app.config.js：默认 API 地址指向本机');
  }
  if (defaultPassword.trim()) {
    findings.push('apps/web-ele/docker/app.config.js：不应预填登录密码');
  }
}

/**
 * 检查构建产物中的开发服务器地址和危险动态执行残留。
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

  for (const file of artifactFiles) {
    const content = await readFile(file, 'utf8');
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
}

/** 从受控运行时配置脚本中读取一个普通字符串字段，不执行脚本。 */
function readJavaScriptStringField(content, key) {
  const escapedKey = key.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const match = content.match(
    new RegExp(String.raw`(?:^|\n)\s*${escapedKey}\s*:\s*(['"])(.*?)\1`, 'u'),
  );
  return match?.[2] ?? '';
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

function displayPath(path) {
  return relative(workspaceRoot, path).replaceAll('\\', '/');
}

await main();
