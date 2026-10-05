/**
 * V8 覆盖率提供者包装：修复区间端点落在编译器生成行上时的静默丢弃。
 *
 * Vitest 3.2 的 v8 提供者用 V8 区间反查源码映射，区间起点或终点所在行没有任何映射段时
 * `offsetToOriginalRelative` 直接返回空，整个函数区间连同它的分支被丢弃；语句计数停在
 * 行对象默认值 1，于是出现"语句全部命中、函数数为 0"的假通过。实测
 * `apps/web-ele/src/layouts/basic.vue` 校准前是 60 条语句全部命中、0 个函数、0 个分支，而 V8
 * 原始数据里 `setup` 与 `_sfc_render` 都有真实函数区间：`<script setup>` 的 setup 包装行由
 * 编译器生成，映射里没有对应段，正是被丢弃的端点；校准后该文件 60 条语句中 37 条计为未执行，
 * `setup` 成为 1 个未覆盖函数。
 *
 * 本包装只把落在无映射行上的端点对齐到区间内最近的真实映射列，命中数与区间层级不变；
 * 区间内完全没有映射的区间保持原样，仍按原实现丢弃。提供者内部结构变化会直接抛错，
 * 不会静默退回旧行为。
 */
import process from 'node:process';

import base from '@vitest/coverage-v8';

/** Base64 VLQ 字母表，映射文本按该表增量编码生成列。 */
const VLQ_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 未执行文件的合成块名；它不对应真实函数，必须原样交给原实现。 */
const EMPTY_REPORT = '(empty-report)';

/** 端点对齐计数，用于在测试输出里证明校准真实生效。 */
const calibration = { files: 0, ranges: 0 };

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
 * @returns 行号从 0 开始的生成列数组（升序）；空数组表示该行没有任何映射。
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
 * @param starts 每行起始偏移。
 * @param offset 原始端点偏移。
 * @param direction 1 表示向后取首列、-1 表示向前取末列。
 * @returns 可回查的端点偏移；该方向没有映射时返回 null。
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
    if (line < 0 || line >= columns.length) {
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

/** 输出校准结果，让测试日志能够直接核对本次运行是否触发该缺陷。 */
function reportCalibration() {
  const detail =
    calibration.ranges > 0
      ? `已对齐 ${calibration.ranges} 个无映射端点区间，涉及 ${calibration.files} 个文件。`
      : '本次运行没有区间端点落在无映射行上。';
  process.stderr.write(`[覆盖率校准] ${detail}\n`);
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
   * 转换单个文件的覆盖率：先对齐无映射端点，再交给原实现统计分母。
   * @param filename 源码绝对路径（file:// 形式）。
   * @param wrapperLength 脚本包裹前缀长度。
   * @param sources 转换结果与源码映射。
   * @param functions V8 原始函数块列表。
   * @returns 原实现产出的单文件覆盖率条目。
   */ async (filename, wrapperLength, sources, functions) => {
    const mappings = sources.sourceMap?.sourcemap?.mappings;
    if (
      !sources.source ||
      typeof mappings !== 'string' ||
      !Array.isArray(functions) ||
      functions.length === 0
    ) {
      return convert(filename, wrapperLength, sources, functions);
    }
    const context = mappingContext(sources.source, mappings);
    const aligned = alignFunctions(functions, context, wrapperLength);
    const changed = aligned.some(
      /** 任意块被替换都说明该文件存在无法回查的端点。 */ (block, index) =>
        block !== functions[index],
    );
    if (changed) {
      calibration.files += 1;
    }
    return convert(filename, wrapperLength, sources, aligned);
  };
  const generate = provider.generateCoverage.bind(provider);
  provider.generateCoverage = /**
   * 生成覆盖率报告：原实现完成后输出本次校准计数。
   * @param options 生成选项，由 Vitest 传入。
   * @returns 原实现产出的覆盖率映射。
   */ async (options) => {
    const coverageMap = await generate(options);
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
