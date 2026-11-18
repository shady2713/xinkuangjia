import type { PluginOption } from 'vite';

const VXE_LIBRARIES = new Set(['vxe-pc-ui', 'vxe-table']);
const TARGET_FILE_RE = /\.(?:vue|ts|tsx|js|jsx|mjs)(?:\?.*)?$/u;
const VXE_IMPORT_RE =
  /(^[ \t]*import\s+\{([^}]+)\}\s+from\s+(['"])(vxe-pc-ui|vxe-table)\3[ \t]*;?)/gmu;

/**
 * 将 PascalCase 组件名转换为 vxe 子目录 kebab-case 名称（如 VxeUI -> vxe-ui，VxeButton -> vxe-button）。
 *
 * @param name 导入的组件标识符
 * @returns kebab-case 目录名
 */
function toVxeSubdir(name: string): string {
  if (name === 'VxeUI') {
    return 'vxe-ui';
  }
  return name
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/gu, '$1-$2')
    .toLowerCase();
}

/**
 * 将单条具名导入语句转换为按需子路径导入代码。
 *
 * @param fullMatch 原始完整匹配文本
 * @param rawSpecifiers 花括号内的导入标识符列表
 * @param libName 目标包名（vxe-pc-ui 或 vxe-table）
 * @returns 转换后的按需导入源码片段与是否发生重写标志
 */
function rewriteVxeImportClause(
  fullMatch: string,
  rawSpecifiers: string,
  libName: string,
): { code: string; rewritten: boolean } {
  if (!VXE_LIBRARIES.has(libName)) {
    return { code: fullMatch, rewritten: false };
  }
  const lines: string[] = [];
  const passthroughTypes: string[] = [];
  for (const rawItem of rawSpecifiers.split(',')) {
    const trimmed = rawItem.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('type ')) {
      passthroughTypes.push(trimmed.slice(5).trim());
      continue;
    }
    const parts = trimmed.split(/\s+as\s+/u).map((s) => s.trim());
    const imported = parts[0];
    if (!imported) {
      continue;
    }
    const local = parts[1] ?? imported;
    const dirName = toVxeSubdir(imported);
    if (imported === 'VxeUI') {
      lines.push(`import ${local} from '${libName}/es/vxe-ui/index.js';`);
    } else {
      const clause = imported === local ? imported : `${imported} as ${local}`;
      lines.push(
        `import { ${clause} } from '${libName}/es/${dirName}/index.js';`,
      );
    }
    lines.push(`import '${libName}/es/${dirName}/style.css';`);
  }
  if (lines.length === 0) {
    return { code: fullMatch, rewritten: false };
  }
  if (passthroughTypes.length > 0) {
    lines.unshift(
      `import type { ${passthroughTypes.join(', ')} } from '${libName}';`,
    );
  }
  return { code: lines.join('\n'), rewritten: true };
}

/**
 * 按需重写 `vxe-table` 与 `vxe-pc-ui` 的具名运行时导入，消除全量入口副作用并兼容 `VxeUI` 默认导出。
 *
 * @returns Vite 按需重写插件
 */
async function viteVxeTableImportsPlugin(): Promise<PluginOption> {
  return {
    enforce: 'pre',
    name: 'basic-framework:vxe-on-demand-imports',
    /**
     * 将全量包导入改写为组件级 ESM 与样式子路径导入。
     *
     * @param code 模块源码
     * @param id 模块路径
     * @returns 改写后的源码；未命中时返回 null
     */
    transform(code, id) {
      if (
        !code ||
        id.includes('node_modules') ||
        !TARGET_FILE_RE.test(id) ||
        (!code.includes('vxe-pc-ui') && !code.includes('vxe-table'))
      ) {
        return null;
      }
      let mutated = false;
      /**
       * 执行单处正则匹配替换。
       *
       * @param fullMatch 完整匹配语句
       * @param _stmt 语句分组
       * @param rawSpecifiers 导入项分组
       * @param _quote 引号分组
       * @param libName 库名分组
       * @returns 替换后的语句
       */
      function replaceMatch(
        fullMatch: string,
        _stmt: string,
        rawSpecifiers: string,
        _quote: string,
        libName: string,
      ) {
        const outcome = rewriteVxeImportClause(
          fullMatch,
          rawSpecifiers,
          libName,
        );
        if (outcome.rewritten) {
          mutated = true;
        }
        return outcome.code;
      }
      const transformed = code.replaceAll(VXE_IMPORT_RE, replaceMatch);
      return mutated ? { code: transformed, map: null } : null;
    },
  };
}

export { viteVxeTableImportsPlugin };
