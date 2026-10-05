/**
 * V8 覆盖率提供者包装：修复区间端点落在编译器生成行上时的静默丢弃，以及匿名函数块不进函数分母。
 *
 * Vitest 3.2 的 v8 提供者用 V8 区间反查源码映射，区间起点或终点所在行没有任何映射段时
 * `offsetToOriginalRelative` 直接返回空，整个函数区间连同它的分支被丢弃；语句计数停在
 * 行对象默认值 1，于是出现"语句全部命中、函数数为 0"的假通过。实测
 * `apps/web-ele/src/layouts/basic.vue` 校准前是 60 条语句全部命中、0 个函数、0 个分支，而 V8
 * 原始数据里 `setup` 与 `_sfc_render` 都有真实函数区间：`<script setup>` 的 setup 包装行由
 * 编译器生成，映射里没有对应段，正是被丢弃的端点；校准后该文件 60 条语句中 37 条计为未执行，
 * `setup` 成为 1 个未覆盖函数。
 *
 * 本包装做两件事，都只改输入给内置转换器的 V8 数据，命中数与区间层级不变：
 * 1. 端点对齐：把落在无映射行上的端点对齐到区间内最近的真实映射列；区间内完全没有映射的
 *    区间保持原样，仍按原实现丢弃。`mappings` 允许省略末尾无映射行，因此只有越过脚本行
 *    范围才算"该方向没有映射"，否则渲染函数这类延伸到末尾的区间会被误判丢弃。
 * 2. 匿名函数补名：V8 把 `defineAsyncComponent(() => import(...))` 这类匿名闭包报成
 *    `functionName` 为空串的函数块（命中数 0 表示创建后从未调用），而内置转换器要求函数名
 *    非空才建立函数条目，这些真实函数因此永远不进分母，出现"函数分母为 0 即自动通过"。
 *    这里按生成代码的 AST 还原真实函数起点并补名，同时排除打包器为绑定合成、源码里并不
 *    存在的 `__vite_ssr_*` 访问器，避免把合成函数计入分母。
 *
 * 提供者内部结构变化或生成代码无法解析时直接抛错，不会静默退回旧行为。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import base from '@vitest/coverage-v8';
import ts from 'typescript';

/** Base64 VLQ 字母表，映射文本按该表增量编码生成列。 */
const VLQ_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 未执行文件的合成块名；它不对应真实函数，必须原样交给原实现。 */
const EMPTY_REPORT = '(empty-report)';

/** 提供者所在目录即前端工程根目录，输入指纹与报告目录都相对它解析。 */
const FRONTEND_ROOT = dirname(fileURLToPath(import.meta.url));

/** 有实现体的函数语法节点：只有它们才该出现在真实函数分母里。 */
const FUNCTION_KINDS = new Set([
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.SetAccessor,
]);

/** 函数起点容差：V8 对 async 等前缀记录的位置与 AST 起点可能相差少数几个字符。 */
const FUNCTION_START_TOLERANCE = 8;

/** Vite SSR 变换为导入导出绑定合成的辅助函数名前缀；它们不对应任何源码函数。 */
const SYNTHETIC_PREFIX = '__vite';

/** 脚本内容前缀之外允许的收尾字符数：vite-node 在模块代码之后还会补少量字符。 */
const SCRIPT_SUFFIX_TOLERANCE = 8;

/** 覆盖率输入清单结构版本；修改键结构必须同步 scripts/workflow/coverage_gate.py。 */
const INPUTS_SCHEMA = 'web-coverage-inputs/v1';

/** 输入缺失时的哨兵值，两侧比较仍能发现新增、替换或卸载。 */
const INPUTS_MISSING = '(missing)';

/** 纳入证据指纹的测量输入文件：提供者、测试配置、锁文件与关键依赖包。 */
const INPUT_FILES = [
  'vitest.config.ts',
  'vitest.coverage-provider.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'node_modules/@vitest/coverage-v8/package.json',
  'node_modules/@vitest/coverage-v8/dist/provider.js',
  'node_modules/vitest/package.json',
  'node_modules/vite/package.json',
  'node_modules/typescript/package.json',
  'node_modules/@vue/compiler-sfc/package.json',
  'node_modules/vue/package.json',
  'node_modules/@vitejs/plugin-vue/package.json',
  'node_modules/@vitejs/plugin-vue-jsx/package.json',
  'node_modules/happy-dom/package.json',
  'node_modules/@vue/test-utils/package.json',
];

/** 需要单独公开已安装版本的关键依赖，供门禁报告具体是哪一项发生变化。 */
const INPUT_DEPENDENCIES = [
  'vitest',
  '@vitest/coverage-v8',
  'vite',
  'typescript',
  '@vue/compiler-sfc',
  'vue',
  '@vitejs/plugin-vue',
  '@vitejs/plugin-vue-jsx',
  'happy-dom',
  '@vue/test-utils',
];

/** 校准计数，用于在测试输出里证明校准真实生效。 */
const calibration = { files: 0, named: 0, ranges: 0 };

/** V8 区间越出脚本范围的文件，其行/函数分母不可信，必须交给门禁判为缺口而不是通过。 */
const unverifiedOffsets = new Set();

/**
 * 还原单个映射段的首字段，即相对同段前一列的生成列增量。
 * @param segment 逗号分隔的单个映射段文本。
 * @returns 生成列增量，可为负数（列回退）。
 * @throws {Error} 段为空或含非 Base64 VLQ 字符时抛出，避免错位映射被当成有效结果。
 */
function segmentDelta(segment) {
  let value = 0;
  let shift = 0;
  let index = 0;
  while (index < segment.length) {
    const digit = VLQ_ALPHABET.indexOf(segment[index]);
    if (digit === -1) {
      throw new Error(`sourcemap 映射段含非法字符：${segment}`);
    }
    index += 1;
    value += (digit & 31) << shift;
    if ((digit & 32) === 0) {
      return (value & 1) === 0 ? value >> 1 : -(value >> 1);
    }
    shift += 5;
  }
  throw new Error(`sourcemap 映射段不完整：${segment}`);
}

/**
 * 解析映射文本，得到每一行可直接回查的生成列。
 * @param mappings sourcemap 的 mappings 字段。
 * @returns 行号从 0 开始的生成列数组（升序）；空数组表示该行没有任何映射，
 * 末尾无映射行按规范被省略，读取时必须按"该行无映射"处理。
 * @throws {Error} 映射文本含非法段时由 segmentDelta 抛出。
 */
function mappedColumns(mappings) {
  const result = [];
  for (const line of mappings.split(';')) {
    const columns = [];
    let column = 0;
    for (const segment of line.split(',')) {
      if (segment === '') {
        continue;
      }
      column += segmentDelta(segment);
      columns.push(column);
    }
    result.push(columns);
  }
  return result;
}

/**
 * 建立单个文件的映射上下文，供端点对齐复用。
 * @param code V8 实际执行的转换后代码。
 * @param mappings sourcemap 的 mappings 字段。
 * @returns 每行起始偏移与逐行生成列。
 */
function mappingContext(code, mappings) {
  const starts = [0];
  // 行尾统一按 \n 切分，\r\n 的行首同样落在 \n 之后，与原实现的切行保持一致。
  let position = code.indexOf('\n');
  while (position !== -1) {
    starts.push(position + 1);
    position = code.indexOf('\n', position + 1);
  }
  return { starts, columns: mappedColumns(mappings) };
}

/**
 * 二分查找偏移所在行号。
 * @param starts 每行起始偏移。
 * @param offset 目标偏移。
 * @returns 从 0 开始的行号。
 */
function lineOfOffset(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/**
 * 沿一个方向寻找最近的、真正带映射的行，并把端点落到该行可回查的列上。
 * @param columns 逐行生成列。
 * @param starts 每行起始偏移，同时界定脚本行范围。
 * @param offset 原始端点偏移。
 * @param direction 1 表示向后取首列、-1 表示向前取末列。
 * @returns 可回查的端点偏移；该方向直到脚本末尾都没有映射时返回 null。
 */
function nearestMappedOffset(columns, starts, offset, direction) {
  let line = lineOfOffset(starts, offset);
  const current = columns[line] ?? [];
  if (current.length > 0) {
    // 该行本身有映射：区间端点由原实现用最近下界/上界回查，这里不做任何改动。
    return offset;
  }
  for (;;) {
    line += direction;
    // mappings 允许省略末尾无映射行，越出列数组只表示该行无映射，必须继续找；只有真正越过
    // 脚本行范围才说明该方向没有可回查位置，此时交给原实现按原语义丢弃。
    if (line < 0 || line >= starts.length) {
      return null;
    }
    const segments = columns[line] ?? [];
    if (segments.length === 0) {
      continue;
    }
    const column = direction > 0 ? segments[0] : segments.at(-1);
    return starts[line] + column;
  }
}

/**
 * 对齐单个区间端点，使源码映射能够回查而不改变命中数。
 * @param range V8 给出的区间，偏移相对脚本起点。
 * @param context 单个文件的映射上下文。
 * @param wrapperLength 脚本包裹前缀长度。
 * @returns 对齐后的区间；区间内没有任何映射时返回 null，由原实现按原语义丢弃。
 */
function alignRange(range, context, wrapperLength) {
  const { columns, starts } = context;
  const start = Math.max(0, range.startOffset - wrapperLength);
  const end = Math.max(start, range.endOffset - wrapperLength);
  const head = nearestMappedOffset(columns, starts, start, 1);
  const tail = nearestMappedOffset(columns, starts, end, -1);
  if (head === null || tail === null || head > tail) {
    return null;
  }
  if (head === start && tail === end) {
    return range;
  }
  calibration.ranges += 1;
  return {
    ...range,
    startOffset: head + wrapperLength,
    endOffset: tail + wrapperLength,
  };
}

/**
 * 重建单个文件的函数块，只替换无法回查的端点。
 * @param functions V8 原始函数块列表。
 * @param context 单个文件的映射上下文。
 * @param wrapperLength 脚本包裹前缀长度。
 * @returns 重建后的函数块；无需改动的块保持同一引用，便于调用方识别本次是否生效。
 */
function alignFunctions(functions, context, wrapperLength) {
  const result = [];
  for (const block of functions) {
    // 合成块不是真实函数，原样返回给原实现。
    if (block.functionName === EMPTY_REPORT) {
      result.push(block);
      continue;
    }
    const ranges = [];
    let changed = false;
    for (const range of block.ranges) {
      const aligned = alignRange(range, context, wrapperLength);
      if (aligned === null || aligned === range) {
        ranges.push(range);
      } else {
        ranges.push(aligned);
        changed = true;
      }
    }
    result.push(changed ? { ...block, ranges } : block);
  }
  return result;
}

/**
 * 判断 V8 区间是否越出"包裹前缀 + 转换后代码"的脚本范围。
 *
 * 模块在 vite-node 之外执行时（实测是 eslint 配置模块被 ESLint 自己的加载器执行），
 * Vitest 拿不到模块执行信息，`startOffset` 退化成 0，而 V8 记录的脚本仍带 209 字符前缀，
 * 于是所有偏移与转换后代码整体错位：区间可以越出代码末尾，行与函数分母都不可信。
 * 这里只做可判定的检测，不做位移猜测，避免用错误位移把未覆盖代码算成已覆盖。
 *
 * @param functions V8 函数块列表。
 * @param codeLength 转换后代码长度。
 * @param wrapperLength Vitest 报告的脚本包裹前缀长度。
 * @returns 存在越界区间时返回 true。
 */
function offsetsOutOfScript(functions, codeLength, wrapperLength) {
  const limit = wrapperLength + codeLength + SCRIPT_SUFFIX_TOLERANCE;
  return functions.some(
    /** 只检查真实函数块：合成块是按原始源码长度造出的占位区间，不是 V8 脚本坐标。 */ (
      block,
    ) =>
      block.functionName !== EMPTY_REPORT &&
      block.ranges.some(
        /** 任一子区间越出脚本范围都说明 Vitest 报的脚本起点与实际执行脚本不一致。 */ (
          range,
        ) => range.endOffset > limit,
      ),
  );
}

/**
 * 判断函数节点是否为打包器为绑定合成的访问器实参，源码里不存在对应函数。
 * @param parent 该函数节点的直接父节点。
 * @returns 父节点是 `__vite` 前缀辅助调用时返回 true。
 */
function syntheticAccessor(parent) {
  if (!parent || !ts.isCallExpression(parent)) {
    return false;
  }
  const callee = parent.expression;
  return ts.isIdentifier(callee) && callee.text.startsWith(SYNTHETIC_PREFIX);
}

/**
 * 收集生成代码里所有真实函数的起点，并标出打包器合成函数。
 * @param code V8 实际执行的转换后代码。
 * @returns 按起点升序排列的函数节点；`synthetic` 为真表示该函数由打包器合成、不对应源码。
 * @throws {Error} 生成代码无法解析时抛出，避免判别静默失效后真实函数继续漏出分母。
 */
function generatedFunctions(code) {
  const file = ts.createSourceFile(
    'coverage-generated.tsx',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (file.parseDiagnostics.length > 0) {
    const first = file.parseDiagnostics[0];
    const { line, character } = file.getLineAndCharacterOfPosition(
      first.start ?? 0,
    );
    throw new Error(
      `覆盖率判别的生成代码无法解析：第 ${line + 1} 行第 ${character + 1} 列 ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}`,
    );
  }
  const result = [];
  /** 深度优先遍历并显式带上父节点，避免额外开启 parent 指针的开销。 */
  const walk = (node, parent) => {
    if (FUNCTION_KINDS.has(node.kind) && node.body) {
      result.push({
        end: node.end,
        start: node.getStart(file),
        synthetic: syntheticAccessor(parent),
      });
    }
    ts.forEachChild(
      node,
      /** 继续遍历子节点，父节点随递归下传，用于识别打包器合成的访问器。 */ (
        child,
      ) => walk(child, node),
    );
  };
  walk(file, undefined);
  return result.toSorted(
    /** 按起点升序排列，供最近邻匹配提前结束扫描。 */ (left, right) =>
      left.start - right.start,
  );
}

/**
 * 在生成代码的函数起点中寻找与 V8 区间起点对应的真实函数。
 * @param candidates 生成代码的函数节点，按起点升序。
 * @param start V8 函数区间起点，相对生成代码。
 * @returns 命中的真实函数节点；没有命中或最近节点是打包器合成函数时返回 null。
 */
function matchGeneratedFunction(candidates, start) {
  let best;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.start - start);
    if (distance > FUNCTION_START_TOLERANCE) {
      if (candidate.start > start) {
        // 候选起点已越过目标，后面的只会更远。
        break;
      }
      continue;
    }
    if (start > candidate.end) {
      continue;
    }
    if (!best || distance < Math.abs(best.start - start)) {
      best = candidate;
    }
  }
  return best && !best.synthetic ? best : null;
}

/**
 * 给 V8 的匿名函数块补名，使内置转换器为真实函数建立分母。
 *
 * V8 对匿名闭包（例如 `defineAsyncComponent(() => import(...))` 的箭头）只给出空函数名，
 * 内置转换器要求函数名非空才建立函数条目，这些真实函数就永远不进分母：创建后从未调用的
 * 闭包命中数为 0 却被当作"没有函数"而自动通过。补名只影响是否建立函数条目，命中数仍取
 * V8 记录的原始计数。
 *
 * @param functions V8 原始函数块列表。
 * @param code V8 实际执行的转换后代码。
 * @param wrapperLength 脚本包裹前缀长度。
 * @returns 补名后的函数块；没有匿名块时返回原数组。
 * @throws {Error} 生成代码无法解析时由 generatedFunctions 抛出。
 */
function nameAnonymousFunctions(functions, code, wrapperLength) {
  const anonymous = functions.filter(
    /** 只有空函数名才需要补名，已命名块与合成块都不处理。 */ (block) =>
      block.functionName === '',
  );
  if (anonymous.length === 0) {
    return functions;
  }
  const candidates = generatedFunctions(code);
  const result = [];
  let index = 0;
  let changed = false;
  for (const block of functions) {
    // 已命名的块由内置转换器负责建立函数条目，这里不动。
    if (block.functionName !== '') {
      result.push(block);
      continue;
    }
    const start = block.ranges[0].startOffset - wrapperLength;
    const match = matchGeneratedFunction(candidates, start);
    // 找不到源码函数（模块包装、打包器辅助函数等）时保持匿名，原实现按原语义丢弃。
    if (!match) {
      result.push(block);
      continue;
    }
    index += 1;
    changed = true;
    calibration.named += 1;
    result.push({ ...block, functionName: `(anonymous_${index})` });
  }
  return changed ? result : functions;
}

/** 输出校准结果，让测试日志能够直接核对本次运行是否触发这些缺陷。 */
function reportCalibration() {
  const detail =
    calibration.ranges > 0 || calibration.named > 0
      ? `已对齐 ${calibration.ranges} 个无映射端点区间、为 ${calibration.named} 个匿名函数块补名，涉及 ${calibration.files} 个文件。`
      : '本次运行没有区间端点落在无映射行上，也没有需要补名的匿名函数块。';
  process.stderr.write(`[覆盖率校准] ${detail}\n`);
}

/**
 * 读取单个输入文件的 sha256 摘要。
 * @param path 绝对路径。
 * @returns 十六进制摘要；文件缺失时返回哨兵值。
 */
function fileDigest(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return INPUTS_MISSING;
  }
}

/**
 * 读取已安装依赖的版本号。
 * @param name 包名。
 * @returns 版本号字符串；未安装或清单无版本时返回哨兵值。
 */
function installedVersion(name) {
  try {
    const manifest = JSON.parse(
      readFileSync(
        join(FRONTEND_ROOT, 'node_modules', name, 'package.json'),
        'utf8',
      ),
    );
    return typeof manifest.version === 'string'
      ? manifest.version
      : INPUTS_MISSING;
  } catch {
    return INPUTS_MISSING;
  }
}

/**
 * 计算本次覆盖率测量的输入摘要：测量配置、提供者、锁文件与关键依赖。
 * @returns 键为 `file:`/`version:` 前缀的摘要映射。
 */
function coverageInputs() {
  const result = {};
  for (const relative of INPUT_FILES) {
    result[`file:${relative}`] = fileDigest(join(FRONTEND_ROOT, relative));
  }
  for (const name of INPUT_DEPENDENCIES) {
    result[`version:${name}`] = installedVersion(name);
  }
  return result;
}

/**
 * 写出本次运行的覆盖率输入清单，供门禁判断报告是否仍然对应当前测量输入。
 * @param reportsDirectory 覆盖率报告目录，相对路径按工程根目录解析。
 * @sideeffects 覆盖式写入 `<报告目录>/coverage-inputs.json`，含脚本坐标不可信的文件清单；
 * 该文件必须早于报告文件生成，门禁据此判断报告是否对应当前测量输入。
 * @throws {Error} 目录无法创建或清单无法写入时抛出，测试运行必须因此失败而不是留下无指纹报告。
 */
function writeCoverageInputs(reportsDirectory) {
  const target = resolve(FRONTEND_ROOT, reportsDirectory);
  mkdirSync(target, { recursive: true });
  writeFileSync(
    join(target, 'coverage-inputs.json'),
    `${JSON.stringify(
      {
        schema: INPUTS_SCHEMA,
        inputs: coverageInputs(),
        unverifiedOffsets: [...unverifiedOffsets].toSorted(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/**
 * 在提供者实例上安装校准后的转换函数与结果汇总。
 * @param provider 内置 v8 提供者实例。
 * @throws {TypeError} 提供者缺少 v8ToIstanbul 时抛出，表示内部结构变化，禁止静默退回旧行为。
 */
function installCalibration(provider) {
  if (typeof provider.v8ToIstanbul !== 'function') {
    throw new TypeError('V8 覆盖率提供者缺少 v8ToIstanbul，无法校准区间回映射');
  }
  const convert = provider.v8ToIstanbul.bind(provider);
  provider.v8ToIstanbul = /**
   * 转换单个文件的覆盖率：先给匿名函数块补名，再对齐无映射端点，最后交给原实现统计分母。
   * @param filename 源码绝对路径（file:// 形式）。
   * @param wrapperLength 脚本包裹前缀长度。
   * @param sources 转换结果与源码映射。
   * @param functions V8 原始函数块列表。
   * @returns 原实现产出的单文件覆盖率条目。
   */ async (filename, wrapperLength, sources, functions) => {
    const mappings = sources.sourceMap?.sourcemap?.mappings;
    // 坐标一致性必须先于任何校准判断：拿不到源码或映射时该文件同样可能整体错位，
    // 只是没有可对齐的端点，仍必须让门禁知道它的分母不可信。
    if (
      typeof sources.source === 'string' &&
      sources.source.length > 0 &&
      Array.isArray(functions) &&
      offsetsOutOfScript(functions, sources.source.length, wrapperLength)
    ) {
      unverifiedOffsets.add(relative(FRONTEND_ROOT, fileURLToPath(filename)));
    }
    if (
      !sources.source ||
      typeof mappings !== 'string' ||
      !Array.isArray(functions) ||
      functions.length === 0
    ) {
      return convert(filename, wrapperLength, sources, functions);
    }
    const context = mappingContext(sources.source, mappings);
    // 补名必须用 V8 原始区间起点判定，端点对齐可能把起点移进函数体而错过 AST 声明位置。
    const named = nameAnonymousFunctions(
      functions,
      sources.source,
      wrapperLength,
    );
    const aligned = alignFunctions(named, context, wrapperLength);
    const changed = aligned.some(
      /** 任意块被替换都说明该文件存在无法回查的端点或匿名真实函数。 */ (
        block,
        index,
      ) => block !== functions[index],
    );
    if (changed) {
      calibration.files += 1;
    }
    return convert(filename, wrapperLength, sources, aligned);
  };
  const generate = provider.generateCoverage.bind(provider);
  provider.generateCoverage = /**
   * 生成覆盖率报告：先写输入清单，再由原实现产出报告并输出本轮校准计数。
   * @param options 生成选项，由 Vitest 传入。
   * @returns 原实现产出的覆盖率映射。
   */ async (options) => {
    const coverageMap = await generate(options);
    writeCoverageInputs(provider.options.reportsDirectory);
    reportCalibration();
    return coverageMap;
  };
}

export default {
  /**
   * 开始采集覆盖率；采集行为与内置 v8 实现完全一致。
   * @param options 采集选项，由 Vitest 传入。
   * @returns 内置实现的结果。
   */
  async startCoverage(options) {
    return base.startCoverage(options);
  },
  /**
   * 取出采集结果；采集行为与内置 v8 实现完全一致。
   * @param options 采集选项，包含模块执行信息。
   * @returns 内置实现的结果。
   */
  async takeCoverage(options) {
    return base.takeCoverage(options);
  },
  /**
   * 停止采集覆盖率；采集行为与内置 v8 实现完全一致。
   * @param options 采集选项，由 Vitest 传入。
   * @returns 内置实现的结果。
   */
  async stopCoverage(options) {
    return base.stopCoverage(options);
  },
  /**
   * 返回安装好校准逻辑的 v8 提供者实例。
   * @returns 已校准区间回映射的覆盖率提供者。
   */
  async getProvider() {
    const provider = await base.getProvider();
    installCalibration(provider);
    return provider;
  },
};
