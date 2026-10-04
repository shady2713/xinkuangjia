/**
 * 开发规范解析器（eslint-config 的 rules/development-parser）真实行为回归。
 *
 * 该模块是离线解析入口：它从 TS、JS 与 Vue 脚本中提取导入、配置位置和无法静态确定的
 * 动态导入，供质量检查判定导入方向与内联端点。导入漏提会让违规依赖逃过检查；把注释或
 * 普通文本里的伪导入当成真实导入会制造误报；Vue 脚本块行偏移算错会让诊断指向错误行；
 * 语法错误时返回部分结果会让检查在残缺事实上继续；动态导入未标记会让检查漏掉无法静态
 * 判断的引用；配置字段识别写错会让内联端点与内联凭据逃过检查；stdio 入口的批次、字段与
 * 体积边界失效会让工具被超大或非法输入拖垮，或在失败时回显源码。用例使用真实源码文本
 * 驱动真实解析器，并真实启动 stdio 入口，不替换被测实现。
 */
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { analyze } from './development-parser.mjs';

/**
 * 计算目标文本在源码中的行号。
 * @param source 完整源码文本。
 * @param needle 需要在源码中定位的片段。
 * @returns 片段所在行号，从 1 开始。
 * @throws Error 源码中找不到该片段时抛出，避免断言基于不存在的行。
 */
function lineOf(source, needle) {
  const index = source
    .split('\n')
    .findIndex(
      /** 只挑出包含目标片段的源码行，其余行与本断言无关。 */ (line) =>
        line.includes(needle),
    );
  if (index === -1) {
    throw new Error(`源码中找不到片段：${needle}`);
  }
  return index + 1;
}

/**
 * 用受控标准输入与标准输出驱动一次 stdio 入口。
 *
 * 入口只在进程参数包含 --stdio 时执行，且会写入 process.exitCode，因此这里临时替换
 * 参数、标准输入、标准输出与标准错误，结束后统一还原，避免影响其他用例。
 * @param chunks 标准输入分片，按顺序提供给入口。
 * @returns 入口的标准输出、标准错误与退出码。
 */
async function runStdio(chunks) {
  const originalArgv = [...process.argv];
  const originalExitCode = process.exitCode;
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const stdout = [];
  const stderr = [];

  process.argv.push('--stdio');
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: Readable.from(chunks),
  });
  process.stdout.write = /** 收集入口的标准输出。 */ (chunk) => {
    stdout.push(String(chunk));
    return true;
  };
  process.stderr.write = /** 收集入口的标准错误。 */ (chunk) => {
    stderr.push(String(chunk));
    return true;
  };

  let result;
  try {
    vi.resetModules();
    await import('./development-parser.mjs');
    result = {
      exitCode: process.exitCode,
      stderr: stderr.join(''),
      stdout: stdout.join(''),
    };
  } finally {
    process.argv.length = 0;
    process.argv.push(...originalArgv);
    process.exitCode = originalExitCode;
    if (stdinDescriptor) {
      Object.defineProperty(process, 'stdin', stdinDescriptor);
    }
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  return result;
}

describe('脚本导入提取', /** 导入清单决定依赖方向检查能否发现越界引用。 */ () => {
  it('提取静态导入、导出转发、import 等号与 import 类型', /** 漏提任一种导入形式都会让违规依赖逃过检查。 */ () => {
    const source = [
      "import a from 'pkg-a';",
      "export { b } from 'pkg-b';",
      "import c = require('pkg-c');",
      "type T = import('pkg-d').T;",
      "const e = import('pkg-e');",
      "const f = require('pkg-f');",
    ].join('\n');

    const result = analyze({ path: 'sample.ts', source });

    expect(result.path).toBe('sample.ts');
    expect(result.imports).toEqual([
      { line: lineOf(source, 'pkg-a'), spec: 'pkg-a' },
      { line: lineOf(source, 'pkg-b'), spec: 'pkg-b' },
      { line: lineOf(source, 'pkg-c'), spec: 'pkg-c' },
      { line: lineOf(source, 'pkg-d'), spec: 'pkg-d' },
      { line: lineOf(source, 'pkg-e'), spec: 'pkg-e' },
      { line: lineOf(source, 'pkg-f'), spec: 'pkg-f' },
    ]);
    expect(result.dynamic).toEqual([]);
  });

  it('把动态导入与动态 require 标记为无法静态确定', /** 静默跳过会让检查漏掉无法静态判断的引用。 */ () => {
    const source = [
      'const target = getTarget();',
      'const a = import(target);',
      'const b = require(target);',
    ].join('\n');

    const result = analyze({ path: 'sample.ts', source });

    expect(result.dynamic).toEqual([
      lineOf(source, 'import(target)'),
      lineOf(source, 'require(target)'),
    ]);
    expect(result.imports).toEqual([]);
  });

  it('注释与普通文本中的伪导入不进入结果', /** 误报会让检查在无违规的源码上失败。 */ () => {
    const source = [
      "// import fake from 'pkg-comment';",
      'const text = "require(\'pkg-text\')";',
      'const real = 1;',
    ].join('\n');

    const result = analyze({ path: 'sample.ts', source });

    expect(result.imports).toEqual([]);
    expect(result.dynamic).toEqual([]);
  });
});

describe('配置位置提取', /** 配置位置决定内联端点与内联凭据能否被拦下。 */ () => {
  it('识别环境变量访问的三种写法', /** 漏掉任一写法会让端点配置逃过检查。 */ () => {
    const source = [
      'const a = process.env.VITE_GLOB_API_URL;',
      "const b = process.env['VITE_GLOB_API_URL'];",
      'const { VITE_GLOB_API_URL: url } = process.env;',
    ].join('\n');

    const result = analyze({ path: 'sample.ts', source });

    expect(result.config).toEqual([
      {
        line: lineOf(source, 'process.env.VITE_GLOB_API_URL'),
        rule: 'config-owner',
      },
      {
        line: lineOf(source, "process.env['VITE_GLOB_API_URL']"),
        rule: 'config-owner',
      },
      { line: lineOf(source, 'VITE_GLOB_API_URL: url'), rule: 'config-owner' },
    ]);
  });

  it('识别内联端点与内联凭据字段', /** 漏识别会让写死的地址与密钥进入生产代码。 */ () => {
    const source = [
      "const a = { baseURL: 'https://api.example.test' };",
      "const b = { apiKey: 'DUMMY-api-value' };",
      "const c = { authToken: 'DUMMY-auth-token' };",
      "const d = { clientSecret: 'DUMMY-client-secret' };",
    ].join('\n');

    const result = analyze({ path: 'sample.ts', source });

    expect(result.config).toEqual([
      { line: lineOf(source, 'baseURL'), rule: 'inline-endpoint' },
      { line: lineOf(source, 'apiKey'), rule: 'inline-credential' },
      { line: lineOf(source, 'authToken'), rule: 'inline-credential' },
      { line: lineOf(source, 'clientSecret'), rule: 'inline-credential' },
    ]);
  });

  it('动态取值不记为配置位置', /** 把动态表达式当成固定值会制造误报。 */ () => {
    const source = [
      'const url = buildUrl();',
      'const a = { baseURL: url };',
      'const b = { apiKey: url };',
    ].join('\n');

    const result = analyze({ path: 'sample.ts', source });

    expect(result.config).toEqual([]);
  });
});

describe('vue 脚本块解析', /** Vue 脚本块的行偏移决定诊断能否指向真实行。 */ () => {
  it('同时解析普通脚本与 setup 脚本并保留原始行号', /** 行偏移算错会让诊断指向模板或上一个脚本块。 */ () => {
    const source = [
      '<template>',
      '  <div />',
      '</template>',
      '<script>',
      "import outer from 'pkg-outer';",
      '</script>',
      '<script setup lang="ts">',
      "import inner from 'pkg-inner';",
      '</script>',
    ].join('\n');

    const result = analyze({ path: 'sample.vue', source });

    expect(result.imports).toEqual([
      { line: lineOf(source, 'pkg-outer'), spec: 'pkg-outer' },
      { line: lineOf(source, 'pkg-inner'), spec: 'pkg-inner' },
    ]);
  });

  it('外链脚本按 src 记为导入', /** 漏掉外链脚本会让脚本文件的依赖逃过检查。 */ () => {
    const source = [
      '<template>',
      '  <div />',
      '</template>',
      '<script src="./external.ts"></script>',
    ].join('\n');

    const result = analyze({ path: 'sample.vue', source });

    expect(result.imports).toEqual([
      { line: lineOf(source, '<script src'), spec: './external.ts' },
    ]);
  });

  it('vue 语法错误时拒绝部分解析', /** 返回残缺结果会让检查在错误事实上继续。 */ () => {
    expect(
      /** 未闭合的模板标签会让 SFC 解析失败。 */ () =>
        analyze({ path: 'bad.vue', source: '<template><div></template>' }),
    ).toThrowError(/Vue 语法错误/u);
  });
});

describe('脚本语言选择', /** 语言选择决定 JSX 与 TypeScript 语法能否被正确解析。 */ () => {
  it('按后缀选择 TSX 与 JSX 解析模式', /** 用 TS 模式解析 JSX 会把合法组件判为语法错误。 */ () => {
    const source = 'const el = <div />;\n';

    expect(analyze({ path: 'view.tsx', source }).imports).toEqual([]);
    expect(analyze({ path: 'view.jsx', source }).imports).toEqual([]);
  });

  it('按后缀选择 JS 解析模式', /** 后缀判断写错会让 JS 文件按 TS 解析而漏掉语法差异。 */ () => {
    for (const path of ['plain.js', 'plain.mjs', 'plain.cjs']) {
      const result = analyze({ path, source: "import a from 'pkg-js';" });
      expect(result.imports).toEqual([{ line: 1, spec: 'pkg-js' }]);
    }
  });

  it('默认按 TypeScript 解析', /** 默认模式写错会让 TS 语法被拒绝。 */ () => {
    const source = "import type { T } from 'pkg-type';\nconst a: T = 1;\n";

    expect(analyze({ path: 'plain.ts', source }).imports).toEqual([
      { line: 1, spec: 'pkg-type' },
    ]);
  });

  it('脚本语法错误时拒绝部分解析', /** 返回残缺结果会让检查在错误事实上继续。 */ () => {
    expect(
      /** 缺少表达式会让脚本解析失败。 */ () =>
        analyze({ path: 'bad.ts', source: 'const = ;' }),
    ).toThrowError(/脚本语法错误/u);
  });
});

describe('stdio 入口', /** 入口边界决定工具在非法或超大输入下是否安全失败。 */ () => {
  it('解析批次并返回导入事实与内置模块清单', /** 正常输入必须返回可消费的 JSON，缺少内置模块清单会让依赖判断失效。 */ async () => {
    const source = "import a from 'pkg-stdio';";
    const payload = Buffer.from(
      JSON.stringify([{ path: 'sample.ts', source }]),
      'utf8',
    );

    const result = await runStdio([payload]);

    // 成功路径不修改进程退出码，未设置时按 0 处理。
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stderr).toBe('');
    const parsed = JSON.parse(result.stdout);
    expect(parsed.files).toEqual([
      {
        config: [],
        dynamic: [],
        imports: [{ line: 1, spec: 'pkg-stdio' }],
        path: 'sample.ts',
      },
    ]);
    expect(parsed.builtins).toContain('fs');
  });

  it('输入不是数组时拒绝并给出可读错误', /** 非法批次继续解析会让工具在错误输入上产生假结果。 */ async () => {
    const result = await runStdio([Buffer.from('{}', 'utf8')]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('源码解析失败');
  });

  it('批次超过上限时拒绝', /** 无上限批次会让单次解析耗尽内存。 */ async () => {
    const files = Array.from(
      { length: 101 },
      /** 生成超过上限的最小合法文件项。 */ (_item, index) => ({
        path: `sample-${index}.ts`,
        source: 'const a = 1;',
      }),
    );

    const result = await runStdio([Buffer.from(JSON.stringify(files), 'utf8')]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('源码解析失败');
  });

  it('文件字段缺失时拒绝', /** 字段校验失效会让解析器读到 undefined 并抛出不可读错误。 */ async () => {
    const result = await runStdio([
      Buffer.from(JSON.stringify([{ path: 'sample.ts' }]), 'utf8'),
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('源码解析失败');
  });

  it('非法 UTF-8 输入时拒绝且不回显源码', /** 回显输入会把被检查源码写进错误输出。 */ async () => {
    const result = await runStdio([Buffer.from([255, 254])]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toContain('\uFFFD');
  });

  it('输入超过 32 MiB 时拒绝', /** 无体积上限会让超大输入耗尽内存。 */ async () => {
    const oversized = Buffer.alloc(32 * 1024 * 1024 + 1, 0x20);

    const result = await runStdio([oversized]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('源码解析失败');
  });
});
