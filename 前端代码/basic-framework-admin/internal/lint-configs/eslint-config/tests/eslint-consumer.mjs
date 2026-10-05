/**
 * 真实 ESLint 配置的进程外消费者：在独立 Node 进程内用仓库真实 flat config 解析并检查源码。
 *
 * 本脚本只收集 ESLint 的原始输出（解析后的规则值与逐条诊断），不做任何通过/失败判定，
 * 判定仍由发起它的 Vitest 用例完成。把消费动作放在子进程的原因是可测量的：
 * `@vitest/coverage-v8` 通过 `node:inspector` 的 `Profiler.startPreciseCoverage` 只采集
 * 当前 isolate，而 `@vben/eslint-config` 的 `dist/index.mjs` 是 jiti 桩，会在同一 isolate 内
 * 用 jiti 的转译器和 `vm` 再执行一遍 `src/index.ts` 及其全部依赖；同一模块由此出现两份脚本
 * 坐标，vite-node 转换后的代码与 jiti 执行的那份对不上，覆盖率分母被判不可信。
 * 子进程不被父进程的 inspector 插桩，因此既保留"真实 ESLint 加载真实配置"的验证内容，
 * 又不让 jiti 的第二份脚本污染被测进程的坐标。
 *
 * 输入（stdin 上的单个 JSON）：
 *   cwd          —— ESLint 的解析基准目录（前端工程根）。
 *   configFiles  —— 需要 `calculateConfigForFile` 的仓库相对路径。
 *   ruleNames    —— 需要从解析结果里取出的规则名。
 *   lintTexts    —— 逐条 `lintText` 的 `{ filePath, source }`。
 * 输出（stdout 上的单个 JSON）：
 *   configs      —— `{ [filePath]: { [ruleName]: 规则配置 } }`。
 *   results      —— 与 `lintTexts` 等长的诊断摘要数组。
 */
import { Buffer } from 'node:buffer';

import { ESLint } from 'eslint';

/**
 * 读取并解析标准输入上的请求 JSON。
 * @returns 消费者请求对象。
 * @throws {Error} 标准输入不是合法 JSON 对象时抛出，避免用空请求伪造通过。
 */
async function readRequest() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (
    !request ||
    typeof request !== 'object' ||
    typeof request.cwd !== 'string' ||
    !Array.isArray(request.configFiles) ||
    !Array.isArray(request.ruleNames) ||
    !Array.isArray(request.lintTexts)
  ) {
    throw new Error('消费者请求结构无效');
  }
  return request;
}

/**
 * 取出解析结果里指定规则的真实配置值。
 * @param config `calculateConfigForFile` 的返回对象。
 * @param ruleNames 需要取出的规则名。
 * @returns 规则名到配置值的映射；未配置的规则取值为 null。
 */
function pickRules(config, ruleNames) {
  const picked = {};
  for (const name of ruleNames) {
    picked[name] = config.rules?.[name] ?? null;
  }
  return picked;
}

/**
 * 把 ESLint 的诊断压成可序列化摘要，只保留断言需要的字段。
 * @param results `lintText` 返回的文件结果数组。
 * @returns 逐文件的诊断摘要。
 */
function summarize(results) {
  return results.map(
    /** 只输出判定所需的计数与消息字段，避免把源码与 fixer 一并回传。 */ (
      result,
    ) => ({
      errorCount: result.errorCount,
      fatalErrorCount: result.fatalErrorCount,
      messages: result.messages.map(
        /** 保留规则标识与定位，供用例核对诊断来自目标规则。 */ (message) => ({
          column: message.column,
          line: message.line,
          message: message.message,
          messageId: message.messageId,
          ruleId: message.ruleId,
          severity: message.severity,
        }),
      ),
    }),
  );
}

/**
 * 用真实配置完成一次请求：解析规则值并逐条检查输入源码。
 * @param request 消费者请求对象。
 * @returns 可序列化的消费者输出。
 * @throws {Error} ESLint 无法加载真实配置或检查源码时抛出，调用方据此判定验证失败。
 */
async function consume(request) {
  const eslint = new ESLint({ cwd: request.cwd });
  const configs = {};
  for (const filePath of request.configFiles) {
    const config = await eslint.calculateConfigForFile(filePath);
    configs[filePath] = pickRules(config, request.ruleNames);
  }
  const results = {};
  for (const [index, item] of request.lintTexts.entries()) {
    const perFile = summarize(
      await eslint.lintText(item.source, { filePath: item.filePath }),
    );
    // lintText 对单份文本只应产出一个文件结果；数量异常说明配置改变了检查范围。
    if (perFile.length !== 1) {
      throw new Error(
        `lintText(${item.filePath}) 产出 ${perFile.length} 个文件结果，期望 1 个`,
      );
    }
    results[index] = perFile[0];
  }
  return { configs, results };
}

/** 请求失败时用非零退出码报告，避免把空结果当成"没有诊断"。 */
try {
  const output = await consume(await readRequest());
  process.stdout.write(JSON.stringify(output));
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
}
