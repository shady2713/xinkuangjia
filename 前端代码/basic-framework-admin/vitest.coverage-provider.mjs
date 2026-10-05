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
 * 本包装做三件事，前两件只改输入给内置转换器的 V8 数据，第三件只改内置转换器产出给门禁的
 * 分母，命中数与区间层级都不变：
 * 1. 端点对齐：把落在无映射行上的端点对齐到区间内最近的真实映射列；区间内完全没有映射的
 *    区间保持原样，仍按原实现丢弃。`mappings` 允许省略末尾无映射行，因此只有越过脚本行范围
 *    才算"该方向没有映射"，否则渲染函数这类延伸到末尾的区间会被误判丢弃。
 * 2. 匿名函数补名：V8 把 `defineAsyncComponent(() => import(...))` 这类匿名闭包报成
 *    `functionName` 为空串的函数块（命中数 0 表示创建后从未调用），而内置转换器要求函数名
 *    非空才建立函数条目，这些真实函数因此永远不进分母，出现"函数分母为 0 即自动通过"。
 *    这里按生成代码的 AST 还原真实函数起点并补名，同时排除打包器为绑定合成、源码里并不
 *    存在的 `__vite_ssr_*` 访问器，避免把合成函数计入分母。
 * 3. 分母纠正：内置转换器按 V8 区间建立函数与语句条目，但转换产物会在源码里造出并不存在的
 *    声明。Vite 把 `import.meta.glob(...)` 改写成以模块路径为键的对象字面量，V8 据此推断出
 *    57 个名为视图路径的"函数"，而源码里只有一次 glob 调用；`@vue/babel-plugin-jsx` 注入的
 *    `_isSlot` 与其合成的 `default` 兜底槽同样没有对应声明，其映射整行塌缩到注释或标点上，
 *    于是出现"未覆盖行落在 JSDoc 的 `/**` 上"。这些条目会被算成未覆盖，使逐文件 100% 门槛
 *    永远无法达成。这里用被测源码的 AST 逐条核对声明位置是否真实存在函数/语句，只剔除同时
 *    满足"证据"与"可证明的转换产物形态"的条目；真实存在但未执行的函数与语句原样保留。
 *
 * 提供者内部结构变化或源码无法解析时直接抛错，不会静默退回旧行为。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parse as parseVueSfc } from '@vue/compiler-sfc';

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

/** JSX 元素节点：编译器由其中的表达式子节点合成槽位函数，源码里没有对应函数。 */
const JSX_KINDS = new Set([
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxFragment,
  ts.SyntaxKind.JsxSelfClosingElement,
]);

/** 合法 ECMAScript 标识符名；不满足者只可能是打包器按对象键推断出来的函数名。 */
const IDENTIFIER_NAME = /^[$_a-z][\w$]*$/iu;

/** 模块说明符形态的函数名：含路径分隔符，源码里的绑定不可能长成这样。 */
const MODULE_SPECIFIER = /[/\\]/;

/** 模块路径名常见的源码扩展名，用于识别没有路径分隔符的相对说明符。 */
const SOURCE_FILE_EXTENSION =
  /\.(?:cjs|css|cts|gif|jpe?g|json|jsx?|less|mjs|mts|png|scss|svg|tsx?|vue|webp)$/;

/** 转换产物塌缩到单个标点上的声明区间不会超过该宽度，真实函数声明的跨度一定更大。 */
const DEGENERATE_WIDTH = 3;

/** 区间预筛：含标识符字符的语句区间一定是真实语句，不参与合成分母剔除。 */
const IDENTIFIER_CHARACTER = /[\w$]/u;

/** 函数起点容差：V8 对 async 等前缀记录的位置与 AST 起点可能相差少数几个字符。 */
const FUNCTION_START_TOLERANCE = 8;

/** Vite SSR 变换为导入导出绑定合成的辅助函数名前缀；它们不对应任何源码函数。 */
const SYNTHETIC_PREFIX = '__vite';

/** 脚本内容前缀之外允许的收尾字符数：vite-node 在模块代码之后还会补少量字符。 */
const SCRIPT_SUFFIX_TOLERANCE = 8;

/** 同一文件全部转换结果的索引缓存；每次生成报告前置空，避免跨轮次复用。 */
let transformIndexCache = null;

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
const calibration = {
  files: 0,
  named: 0,
  ranges: 0,
  reselected: 0,
  syntheticFunctions: 0,
  syntheticStatements: 0,
  skippedSources: 0,
};

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
 * 去掉模块标识上的查询串与散列，得到它对应的物理文件路径。
 *
 * 与内置提供者的 `cleanUrl` 保持同一口径：先解码再截断。SFC 的入口模块与它的
 * `?vue&type=script&lang.tsx` 虚拟子模块因此归一到同一个路径，这正是内置实现发生覆盖的场景。
 *
 * @param id Vite 模块标识或 fetchCache 键。
 * @returns 已归一化的物理路径；标识含非法百分号转义时按原样截断。
 */
function cleanModuleId(id) {
  let decoded = id;
  try {
    decoded = decodeURI(id);
  } catch {
    // 非法转义只影响解码，截断查询串仍然可用，不能因此放弃整份索引。
  }
  return normalize(decoded.replace(/[?#].*$/su, ''));
}

/**
 * 建立「同一物理文件的全部转换结果」索引。
 *
 * 内置实现用 `cleanUrl` 归一化后每个路径只保留先入的一条，而无模板 `<script lang="tsx">` 的
 * SFC 入口只是 re-export 薄包装：Vitest 先取到它，V8 记录的却是脚本块虚拟模块的坐标，两者长度
 * 相差一个数量级，再叠加该包装的空源码映射，整个文件就变成 0 语句 0 函数。这里保留全部候选，
 * 供后续按 V8 坐标重新挑选。
 *
 * @param provider 内置 v8 提供者实例。
 * @returns 物理路径到全部候选转换结果的映射；拿不到 fetchCache 时为空映射。
 */
function transformIndex(provider) {
  if (transformIndexCache) {
    return transformIndexCache;
  }
  const cache = provider?.ctx?.vitenode?.fetchCache;
  const index = new Map();
  if (cache instanceof Map) {
    for (const [key, value] of cache.entries()) {
      const result = value?.result;
      if (typeof result?.code !== 'string') {
        continue;
      }
      const path = cleanModuleId(String(key));
      const candidates = index.get(path);
      if (candidates) {
        candidates.push(result);
      } else {
        index.set(path, [result]);
      }
    }
  }
  transformIndexCache = index;
  return index;
}

/**
 * 取 V8 函数块的最大区间终点，即该脚本实际被执行代码的长度下界。
 * @param functions V8 函数块列表。
 * @returns 最大终点偏移；只有未执行文件的合成块时返回 0。
 */
function scriptLengthFloor(functions) {
  let floor = 0;
  for (const block of functions) {
    if (block.functionName === EMPTY_REPORT) {
      continue;
    }
    for (const range of block.ranges) {
      floor = Math.max(floor, range.endOffset);
    }
  }
  return floor;
}

/**
 * 判断当前转换结果能否表示 V8 实际执行的脚本。
 * @param sources 内置实现选中的转换结果。
 * @param functions V8 函数块列表。
 * @param wrapperLength 脚本包裹前缀长度。
 * @returns 源码映射为空或脚本长度明显不足时返回 true，表示需要重新挑选转换结果。
 */
function sourcesUnusable(sources, functions, wrapperLength) {
  const mappings = sources.sourceMap?.sourcemap?.mappings;
  if (typeof sources.source !== 'string' || typeof mappings !== 'string') {
    return true;
  }
  if (mappings.length === 0) {
    return true;
  }
  return (
    scriptLengthFloor(functions) - wrapperLength >
    sources.source.length + SCRIPT_SUFFIX_TOLERANCE
  );
}

/**
 * 在当前转换结果无法表示 V8 脚本时，按 V8 坐标从同一文件的其它转换结果里重选一份。
 *
 * 三个条件必须同时成立，缺一不可，避免把真实坐标错位（例如同一 isolate 内的第二套转译器）
 * 悄悄改成"看起来正常"：
 * 1. 当前转换结果不可用（映射为空，或脚本长度不足以覆盖 V8 区间）；
 * 2. 该文件存在另一个转换结果，其代码长度足以覆盖 V8 区间；
 * 3. 候选自带非空源码映射，能真实回查源码位置。
 * 不同时成立时保持原样，由内置实现与 `unverifiedOffsets` 按原语义处置。
 *
 * @param provider 内置 v8 提供者实例。
 * @param filename 源码路径的 file:// 形式。
 * @param wrapperLength 脚本包裹前缀长度。
 * @param sources 内置实现选中的转换结果。
 * @param functions V8 原始函数块列表。
 * @returns 重选后的转换结果；无需重选或无法重选时返回 null。
 */
async function reselectSources(
  provider,
  filename,
  wrapperLength,
  sources,
  functions,
) {
  if (
    !Array.isArray(functions) ||
    functions.length === 0 ||
    typeof provider?.getSources !== 'function' ||
    !sourcesUnusable(sources, functions, wrapperLength)
  ) {
    return null;
  }
  const needed = scriptLengthFloor(functions) - wrapperLength;
  // 未执行文件只有合成块（长度下界为 0）：那条路径由内置实现按原始源码长度造占位区间，
  // 重选会把它换成另一份脚本的坐标，属于无谓的行为变更，这里必须保持原样。
  if (needed <= 0) {
    return null;
  }
  const path = normalize(fileURLToPath(filename));
  const candidates = transformIndex(provider).get(path);
  if (!candidates) {
    return null;
  }
  let best;
  for (const candidate of candidates) {
    const mappings = candidate.map?.mappings;
    // 只有自带非空映射、且长度足够覆盖 V8 区间、又确实不是当前那一份的候选才可用。
    if (
      candidate.code === sources.source ||
      typeof mappings !== 'string' ||
      mappings.length === 0 ||
      candidate.code.length + SCRIPT_SUFFIX_TOLERANCE < needed
    ) {
      continue;
    }
    // 取长度最接近下界的候选，避免选中比实际执行脚本更长的另一份转译产物。
    if (!best || candidate.code.length < best.code.length) {
      best = candidate;
    }
  }
  if (!best) {
    return null;
  }
  /** 候选已由索引提供：任何再次转换都会引入第二份坐标，这里明确拒绝回退。 */
  const refuseRetransform = () => undefined;
  const chosen = await provider.getSources(
    filename,
    new Map([[path, best]]),
    refuseRetransform,
    functions,
  );
  const mappings = chosen?.sourceMap?.sourcemap?.mappings;
  if (typeof mappings !== 'string' || mappings.length === 0) {
    return null;
  }
  calibration.reselected += 1;
  return chosen;
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
    calibration.ranges > 0 ||
    calibration.named > 0 ||
    calibration.reselected > 0
      ? `已对齐 ${calibration.ranges} 个无映射端点区间、为 ${calibration.named} 个匿名函数块补名、` +
        `为 ${calibration.reselected} 个文件按 V8 坐标重选转换结果，涉及 ${calibration.files} 个文件。`
      : '本次运行没有区间端点落在无映射行上，也没有需要补名的匿名函数块。';
  process.stderr.write(
    `[覆盖率校准] ${detail}已从分母剔除 ${calibration.syntheticFunctions} 个源码中不存在的转换产物函数、` +
      `${calibration.syntheticStatements} 条源码中不存在的转换产物语句，` +
      `${calibration.skippedSources} 个文件因源码不可读而未做分母纠正。\n`,
  );
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

/** 同一文件源码证据的索引缓存；每次生成报告前置空，避免跨轮次复用。 */
let sourceEvidenceCache = null;

/**
 * 按 SFC 块声明的语言选择解析种类。
 *
 * `.vue` 扩展名无法让 TypeScript 推断脚本种类，`lang="tsx"` 必须按 TSX 解析，
 * 否则 JSX 会被当成类型断言而解析失败，JSX 区间证据随之整体失效。
 *
 * @param lang SFC 块声明的语言。
 * @returns 对应的 TypeScript 解析种类。
 */
function scriptKindOf(lang) {
  if (lang === 'tsx') {
    return ts.ScriptKind.TSX;
  }
  if (lang === 'jsx') {
    return ts.ScriptKind.JSX;
  }
  if (lang === 'js' || lang === 'mjs' || lang === 'cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/**
 * 计算每一行的起始偏移，供行号列号与偏移互查。
 * @param source 源码正文。
 * @returns 行号从 0 开始的起始偏移数组。
 */
function lineStartOffsets(source) {
  const starts = [0];
  for (
    let at = source.indexOf('\n');
    at !== -1;
    at = source.indexOf('\n', at + 1)
  ) {
    starts.push(at + 1);
  }
  return starts;
}

/**
 * 把 1 基行号与 0 基列号换算成源码偏移。
 * @param lineStarts 每行起始偏移。
 * @param line 1 基行号。
 * @param column 0 基列号。
 * @returns 对应的偏移；行号越界时返回 -1。
 */
function offsetOfLocation(lineStarts, line, column) {
  if (line < 1 || line > lineStarts.length) {
    return -1;
  }
  return lineStarts[line - 1] + column;
}

/**
 * 判断源码在给定偏移处是否真实声明了函数。
 * @param evidence 单个源码文件的证据。
 * @param offset 待判定的源码偏移。
 * @returns 最近函数起点落在容差内时返回 true，表示该偏移确有源码函数，不能剔除。
 */
function hasSourceFunction(evidence, offset) {
  for (const start of evidence.functions) {
    if (Math.abs(start - offset) <= FUNCTION_START_TOLERANCE) {
      return true;
    }
  }
  return false;
}

/**
 * 判断偏移是否落在给定的区间集合内。
 * @param ranges 区间集合，元素为 [起点, 终点]。
 * @param offset 待判定的源码偏移。
 * @returns 落在任一区间内时返回 true。
 */
function withinRanges(ranges, offset) {
  for (const [start, end] of ranges) {
    if (offset >= start && offset <= end) {
      return true;
    }
  }
  return false;
}

/**
 * 收集一段脚本里真实函数的起点，以及 JSX 与模板块区间。
 *
 * 三个集合都是剔除合成项的判据证据：函数起点证明"该位置确有源码函数"，JSX 与模板区间
 * 证明"该位置的函数由编译器从子节点或模板合成"。
 *
 * @param text 脚本正文。
 * @param scriptKind 该脚本的解析种类。
 * @param base 脚本正文在原始文件中的起始偏移。
 * @param evidence 复用的证据对象，结果原地追加。
 * @throws {Error} 脚本无法解析时抛出，避免判据静默失效后合成项继续留在分母里。
 */
function collectSourceNodes(text, scriptKind, base, evidence) {
  const file = ts.createSourceFile(
    'coverage-source.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  if (file.parseDiagnostics.length > 0) {
    const first = file.parseDiagnostics[0];
    const { line, character } = file.getLineAndCharacterOfPosition(
      first.start ?? 0,
    );
    throw new Error(
      `覆盖率判据的源码无法解析：第 ${line + 1} 行第 ${character + 1} 列 ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}`,
    );
  }
  /**
   * 深度优先遍历，显式收集函数起点与 JSX 元素区间。
   * @param node 当前语法节点。
   */
  const walk = (node) => {
    if (FUNCTION_KINDS.has(node.kind) && node.body) {
      evidence.functions.push(base + node.getStart(file));
    }
    if (JSX_KINDS.has(node.kind)) {
      evidence.jsx.push([base + node.getStart(file), base + node.end]);
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
}

/**
 * 懒加载单个源码文件的注释字符偏移集合。
 * @param evidence 单个源码文件的证据。
 * @returns 注释覆盖的字符偏移集合；源码无法扫描时为空集合。
 */
function commentOffsets(evidence) {
  if (evidence.comments) {
    return evidence.comments;
  }
  const offsets = new Set();
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    evidence.source,
  );
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      for (
        let at = scanner.getTokenStart();
        at < scanner.getTokenEnd();
        at += 1
      ) {
        offsets.add(at);
      }
    }
  }
  evidence.comments = offsets;
  return offsets;
}

/**
 * 建立单个源码文件的判据证据。
 *
 * 只读 V8 实际执行的脚本对应的物理源码：覆盖率报告里的路径与门禁枚举的路径必须一致，
 * 否则证据与分母会指向不同文件。文件读不到时返回 null，由调用方放弃剔除而保持原样。
 *
 * @param sourcePath 被测源码的绝对路径。
 * @returns 源码正文、真实函数起点、JSX 区间、模板块区间与行起始偏移。
 * @throws {Error} 源码存在但无法解析时抛出，禁止用失效判据继续统计分母。
 */
function sourceEvidence(sourcePath) {
  if (!sourceEvidenceCache) {
    sourceEvidenceCache = new Map();
  }
  const cached = sourceEvidenceCache.get(sourcePath);
  if (cached !== undefined) {
    return cached;
  }
  let source = null;
  try {
    source = readFileSync(sourcePath, 'utf8');
  } catch {
    // 读不到源码时没有证据可依据，调用方按"不剔除"处理并计数，不会因此放宽门槛。
    source = null;
  }
  let evidence = null;
  if (source !== null) {
    evidence = {
      source,
      functions: [],
      jsx: [],
      templates: [],
      lineStarts: lineStartOffsets(source),
      comments: null,
    };
    if (sourcePath.endsWith('.vue')) {
      const result = parseVueSfc(source, { filename: sourcePath });
      if (result.errors.length > 0) {
        throw new Error(`覆盖率判据的 Vue 源码无法解析：${sourcePath}`);
      }
      const descriptor = result.descriptor;
      if (descriptor.template) {
        evidence.templates.push([
          descriptor.template.loc.start.offset,
          descriptor.template.loc.end.offset,
        ]);
      }
      for (const block of [descriptor.script, descriptor.scriptSetup]) {
        if (block) {
          collectSourceNodes(
            block.content,
            scriptKindOf(block.lang),
            block.loc.start.offset,
            evidence,
          );
        }
      }
    } else if (sourcePath.endsWith('.tsx')) {
      collectSourceNodes(source, ts.ScriptKind.TSX, 0, evidence);
    } else if (sourcePath.endsWith('.jsx')) {
      collectSourceNodes(source, ts.ScriptKind.JSX, 0, evidence);
    } else if (/\.(?:m|c)?js$/u.test(sourcePath)) {
      collectSourceNodes(source, ts.ScriptKind.JS, 0, evidence);
    } else {
      collectSourceNodes(source, ts.ScriptKind.TS, 0, evidence);
    }
    evidence.functions.sort(
      /** 起点升序排列，供最近邻判定提前结束扫描。 */ (left, right) =>
        left - right,
    );
  }
  sourceEvidenceCache.set(sourcePath, evidence);
  return evidence;
}

/**
 * 收集应从函数分母里剔除的转换产物条目。
 *
 * 判据由"证据"和"形态"两部分同时成立才生效，缺一不可：
 * 1. 证据：源码 AST 在该声明起点处没有真实函数节点，且该起点不在 SFC 模板块内
 *    （模板渲染函数由编译器从模板生成，属于源码真实行为的载体，必须留在分母里）。
 * 2. 形态：命中以下任一条可证明为转换产物的形态。
 *    - 模块路径名：函数名不是合法标识符而是模块说明符，源码绑定不可能取该名字。
 *      Vite 把 `import.meta.glob(...)` 改写成 `Object.assign({ "路径": () => import(...) })`，
 *      V8 按对象键推断出加载函数名，57 个视图文件于是变成 57 个"源码里不存在"的函数。
 *    - 注入辅助函数：函数名是合法标识符但源码正文里完全不出现，且声明区间退化为
 *      几个字符。`@vue/babel-plugin-jsx` 注入的 `_isSlot` 就属于这一类，它的整行映射
 *      都塌缩到同一个源码列上，才会出现"函数声明落在 JSDoc 的 `/**` 上"。
 *    - JSX 槽兜底：函数名为 `default` 且声明起点落在 JSX 元素节点内。JSX 子节点
 *      `{expr}` 被改写成 `_isSlot(x) ? x : { default: () => [x] }` 的兜底槽，
 *      该兜底函数在源码里没有对应声明。
 *
 * @param entry 内置转换器产出的单文件 Istanbul 条目。
 * @param evidence 单个源码文件的证据。
 * @returns 需要剔除的函数条目键集合；没有命中时为空集合。
 */
function syntheticFunctionKeys(entry, evidence) {
  const result = new Set();
  const map = entry.fnMap;
  if (!map || typeof map !== 'object') {
    return result;
  }
  for (const [key, member] of Object.entries(map)) {
    const declaration = member?.decl;
    if (!declaration?.start || typeof declaration.start.line !== 'number') {
      continue;
    }
    const start = offsetOfLocation(
      evidence.lineStarts,
      declaration.start.line,
      declaration.start.column,
    );
    if (start < 0) {
      continue;
    }
    const end = offsetOfLocation(
      evidence.lineStarts,
      declaration.end?.line ?? declaration.start.line,
      declaration.end?.column ?? declaration.start.column,
    );
    const name = typeof member.name === 'string' ? member.name : '';
    const degenerate =
      declaration.start.line === declaration.end?.line &&
      end - start <= DEGENERATE_WIDTH;
    const isModuleSpecifier =
      !IDENTIFIER_NAME.test(name) &&
      (MODULE_SPECIFIER.test(name) || SOURCE_FILE_EXTENSION.test(name));
    const isInjectedHelper =
      IDENTIFIER_NAME.test(name) &&
      degenerate &&
      !evidence.source.includes(name);
    const isSlotFallback =
      name === 'default' && withinRanges(evidence.jsx, start);
    if (!isModuleSpecifier && !isInjectedHelper && !isSlotFallback) {
      continue;
    }
    // 证据关：模板内位置与真实函数声明位置都必须保留，避免把源码里存在的函数剔出分母。
    if (
      withinRanges(evidence.templates, start) ||
      hasSourceFunction(evidence, start)
    ) {
      continue;
    }
    result.add(key);
  }
  return result;
}

/**
 * 收集应从语句分母里剔除的转换产物条目。
 *
 * 判据同样是"区间里没有任何可执行字符"加"形态退化"两条同时成立：
 * 区间字符只有空白与注释，且要么退化为同行三个字符以内、要么整段落在同一个注释 token 内。
 * 另外要求该语句的起始行本身不是代码行：否则该行可能承载真实未覆盖语句，剔除同行的注释或
 * 空白片段会让真实缺口消失，这里必须拒绝。
 *
 * @param entry 内置转换器产出的单文件 Istanbul 条目。
 * @param evidence 单个源码文件的证据。
 * @returns 需要剔除的语句条目键集合；没有命中时为空集合。
 */
function syntheticStatementKeys(entry, evidence) {
  const result = new Set();
  const map = entry.statementMap;
  if (!map || typeof map !== 'object') {
    return result;
  }
  for (const [key, member] of Object.entries(map)) {
    if (!member?.start || typeof member.start.line !== 'number') {
      continue;
    }
    const start = offsetOfLocation(
      evidence.lineStarts,
      member.start.line,
      member.start.column,
    );
    const end = offsetOfLocation(
      evidence.lineStarts,
      member.end?.line ?? member.start.line,
      member.end?.column ?? member.start.column,
    );
    if (start < 0 || end <= start) {
      continue;
    }
    const text = evidence.source.slice(start, end);
    // 含标识符字符的区间一定是真实语句，先做最便宜的排除。
    if (IDENTIFIER_CHARACTER.test(text)) {
      continue;
    }
    const comments = commentOffsets(evidence);
    let executable = false;
    for (let at = start; at < end; at += 1) {
      if (!comments.has(at) && !/\s/u.test(evidence.source[at])) {
        executable = true;
        break;
      }
    }
    if (executable) {
      continue;
    }
    const degenerate =
      member.start.line === member.end.line && end - start <= DEGENERATE_WIDTH;
    let allComment = true;
    for (let at = start; at < end && allComment; at += 1) {
      allComment = comments.has(at);
    }
    if (!degenerate && !allComment) {
      continue;
    }
    // 起始行必须是空白或注释行：同行有代码时该行可能承载真实未覆盖语句。
    const lineStart = evidence.lineStarts[member.start.line - 1];
    const lineEnd =
      member.start.line < evidence.lineStarts.length
        ? evidence.lineStarts[member.start.line] - 1
        : evidence.source.length;
    let lineHasCode = false;
    for (let at = lineStart; at < lineEnd; at += 1) {
      if (!comments.has(at) && !/\s/u.test(evidence.source[at])) {
        lineHasCode = true;
        break;
      }
    }
    if (!lineHasCode) {
      result.add(key);
    }
  }
  return result;
}

/**
 * 按保留条目重建计数与位置映射，键值重新连续编号。
 *
 * Istanbul 的计数与位置映射必须键集一致，门禁会逐键核对；直接删除键会留下空洞，
 * 让下游报告读取器按连续下标遍历时读到 undefined，因此这里重新编号。
 *
 * @param counters 命中数映射。
 * @param locations 位置映射。
 * @param removed 需要剔除的键集合；为空时返回原对象。
 * @returns 剔除并重新编号后的两个映射；无需改动时返回原对象。
 */
function dropEntries(counters, locations, removed) {
  if (removed.size === 0 || !counters || !locations) {
    return [counters, locations];
  }
  const nextCounters = {};
  const nextLocations = {};
  let index = 0;
  for (const key of Object.keys(locations)) {
    if (removed.has(key)) {
      continue;
    }
    nextLocations[String(index)] = locations[key];
    nextCounters[String(index)] = counters[key];
    index += 1;
  }
  return [nextCounters, nextLocations];
}

/**
 * 把转换结果映射的键解析成被测源码的绝对路径。
 *
 * 键就是内置转换器解析源码映射后得到的原始源码路径，也正是门禁读取报告的路径；
 * 虚拟子模块的查询串在这里被截断，归一到物理文件。
 *
 * @param key 转换结果映射的键。
 * @returns 归一化后的绝对路径；不是绝对路径时返回 null。
 */
function convertedSourcePath(key) {
  let raw = String(key);
  try {
    raw = fileURLToPath(raw);
  } catch {
    // 不是 file: 形式时按原样处理，查询串截断仍然可用。
  }
  const path = normalize(cleanModuleId(raw));
  return path.startsWith('/') ? path : null;
}

/**
 * 从单文件覆盖率条目里剔除源码中不存在的合成函数与合成语句。
 *
 * 只改输入给门禁的分母，命中数、区间层级与真实源码函数/语句一一对应：
 * 真实存在但未执行的函数与语句仍按原样计为未覆盖。源码读不到或条目结构异常时保持原样，
 * 缺口因此不会被掩盖，只是不再纠正，并由校准计数在日志里显式暴露。
 *
 * @param entry 内置转换器产出的单文件 Istanbul 条目。
 * @param sourcePath 该条目的源码绝对路径，与门禁读取报告时使用的路径一致。
 * @returns 剔除合成项后的条目；无需剔除或无法判定时返回原条目。
 */
function correctSourceEntry(entry, sourcePath) {
  if (!entry || typeof entry !== 'object') {
    return entry;
  }
  const evidence = sourceEvidence(sourcePath);
  if (!evidence) {
    calibration.skippedSources += 1;
    return entry;
  }
  const functions = syntheticFunctionKeys(entry, evidence);
  let statements = syntheticStatementKeys(entry, evidence);
  // 剔除不能把语句分母清空：门禁把"有函数但一条语句都没有"判为 invalid-zero（证据不可用），
  // 那比留下合成条目更糟。真到这一步说明整份条目都建在注释行上，此时只纠正函数分母。
  if (
    statements.size > 0 &&
    Object.keys(entry.statementMap ?? {}).length === statements.size &&
    Object.keys(entry.fnMap ?? {}).length > 0
  ) {
    statements = new Set();
  }
  if (functions.size === 0 && statements.size === 0) {
    return entry;
  }
  calibration.syntheticFunctions += functions.size;
  calibration.syntheticStatements += statements.size;
  const [functions_, fnMap] = dropEntries(entry.f, entry.fnMap, functions);
  const [statements_, statementMap] = dropEntries(
    entry.s,
    entry.statementMap,
    statements,
  );
  return { ...entry, f: functions_, fnMap, s: statements_, statementMap };
}

/**
 * 从内置转换器的返回值里剔除所有源码中不存在的合成条目。
 *
 * 内置转换器返回的是「源码路径 → 单文件条目」映射而不是扁平条目：1:many 源码映射可以解析出
 * 多份源码，每条各自成键。因此必须逐键按其自身路径核对，既不能按 filename 猜路径，也不能只
 * 处理第一份，否则键不相同的那一份会把合成分母静默留在报告里。
 *
 * @param converted 内置转换器的返回值。
 * @param filename 被测脚本的 file:// 形式，仅在键无法解析出绝对路径时作为兜底证据来源。
 * @returns 剔除合成项后的映射；无需剔除或无法判定时返回原值。
 */
function excludeSyntheticEntries(converted, filename) {
  if (!converted || typeof converted !== 'object') {
    return converted;
  }
  const result = {};
  let changed = false;
  for (const [key, entry] of Object.entries(converted)) {
    const sourcePath =
      convertedSourcePath(key) ?? convertedSourcePath(filename);
    if (sourcePath === null) {
      calibration.skippedSources += 1;
      result[key] = entry;
      continue;
    }
    const corrected = correctSourceEntry(entry, sourcePath);
    result[key] = corrected;
    changed = changed || corrected !== entry;
  }
  return changed ? result : converted;
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
    // 先确定"这份源码映射能否表示 V8 实际执行的脚本"：无模板 `<script lang="tsx">` 的 SFC
    // 入口只是 re-export 薄包装，内置实现按 cleanUrl 折叠后选中了它，而 V8 记录的是脚本块
    // 虚拟子模块的坐标。能按坐标重选时必须先重选，否则空映射会让整个文件变成 0 语句 0 函数，
    // 报告既丢分母又丢命中数；重选失败则保持原样，仍由下面的越界判定交给门禁。
    const resolved = await reselectSources(
      provider,
      filename,
      wrapperLength,
      sources,
      functions,
    );
    if (resolved) {
      sources = resolved;
    }
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
      // 没有函数区间（未执行文件、纯类型文件）时仍要纠正分母：原实现按源码长度造出的
      // 占位条目同样可能落在注释行上，留着会让门禁给出源码里不存在的未覆盖行。
      return excludeSyntheticEntries(
        await convert(filename, wrapperLength, sources, functions),
        filename,
      );
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
    // 分母纠正必须在原实现产出条目之后：内置转换器按 V8 区间建立函数与语句条目，
    // 只有拿到条目才能用源码 AST 逐条核对"该声明位置在源码里是否真的存在函数/语句"。
    return excludeSyntheticEntries(
      await convert(filename, wrapperLength, sources, aligned),
      filename,
    );
  };
  const generate = provider.generateCoverage.bind(provider);
  provider.generateCoverage = /**
   * 生成覆盖率报告：先写输入清单，再由原实现产出报告并输出本轮校准计数。
   * @param options 生成选项，由 Vitest 传入。
   * @returns 原实现产出的覆盖率映射。
   */ async (options) => {
    // 每轮生成报告都重建转换结果索引：fetchCache 在测试执行期间持续增长，索引不能跨轮复用。
    transformIndexCache = null;
    // 源码证据同样只在单轮内复用：测试期间源码不应变化，跨轮复用会掩盖真实的重新采集。
    sourceEvidenceCache = null;
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
