// @vitest-environment node
/**
 * 前端注释检查规则（rules/web-comments）真实行为回归。
 *
 * 该模块是 ESLint 插件、命令行与 Python 入口共用的离线注释检查实现：它解析真实 TypeScript 与
 * Vue 源码，输出带原始行号的诊断。规则码写错会让调用方无法定位禁用的检查；模块说明缺失
 * 会让文件顶部没有可追溯的职责；公开声明未要求 JSDoc 会让调用契约散落在实现里；参数、
 * 返回与异常标签的过期或缺失校验失效会让注释与真实签名长期分叉；语法错误未单独成码会让
 * 语法问题被误报成注释问题；无脚本组件的说明检查失效会让纯模板组件没有任何业务说明。
 * 用例全部使用真实源码文本驱动导出的检查函数，只断言诊断的规则码与行号。
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { checkWebFile, documentation } from './web-comments.mjs';

/**
 * 构造一次检查的输入文件。
 * @param path 目标文件路径，扩展名决定使用的语言解析器。
 * @param source 文件源码文本。
 * @param options 可选的增量行号与新文件标记。
 * @param options.lines 增量检查的行号列表；null 表示全量检查。
 * @param options.new 是否按新增文件处理（影响模块说明与无脚本组件说明检查）。
 * @returns 可直接交给检查函数的输入文件。
 */
function input(path, source, options = {}) {
  return {
    lines: options.lines ?? null,
    new: options.new ?? false,
    path,
    source,
  };
}

/**
 * 取出诊断的规则码集合。
 * @param findings 检查函数返回的诊断列表。
 * @returns 去重后的规则码数组。
 */
function rules(findings) {
  return [
    ...new Set(findings.map(/** 提取单条诊断的规则码。 */ (item) => item.rule)),
  ];
}

describe('模块说明检查', /** 文件顶部缺少中文职责说明时无法追溯模块用途。 */ () => {
  it('新增文件缺少中文模块说明时报 web-module-doc', /** 该规则是文件级职责的唯一入口。 */ () => {
    const findings = checkWebFile(
      input('/tmp/DUMMY-module.ts', 'export const value = 1;\n', { new: true }),
    );

    expect(findings).toContainEqual({
      line: 1,
      message: '模块或组件顶部缺少中文职责说明',
      path: '/tmp/DUMMY-module.ts',
      rule: 'web-module-doc',
    });
  });

  it('顶部有中文职责说明时不报模块诊断', /** 有效说明必须被接受，否则正常文件会被误报。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-module.ts',
        '/** 输出一个常量。 */\nexport const value = 1;\n',
        { new: true },
      ),
    );

    expect(rules(findings)).not.toContain('web-module-doc');
  });

  it('声明前只有占位词的说明不算有效说明', /** 占位词通过会让职责说明形同虚设。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-placeholder.ts',
        'export const other = 1;\n/** 待补充 */\nexport function run() {\n  return 1;\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-doc');
  });

  it('全量检查时无视行号范围', /** 全量入口必须覆盖所有声明。 */ () => {
    const findings = checkWebFile(
      input('/tmp/DUMMY-module.ts', 'export const value = 1;\n'),
    );

    expect(rules(findings)).toContain('web-module-doc');
  });

  it('增量检查只裁决与改动行相交的声明', /** 未相交的旧声明不应阻断本次改动。 */ () => {
    const source = '/** 常量说明。 */\nexport const value = 1;\n';
    const untouched = checkWebFile(
      input('/tmp/DUMMY-module.ts', source, { lines: [1], new: false }),
    );
    const touched = checkWebFile(
      input('/tmp/DUMMY-module.ts', source, { lines: [2], new: false }),
    );

    // 第一行落在模块说明注释上，第二行落在声明上：只有后者会驱动检查。
    expect(untouched).toEqual([]);
    expect(touched).toEqual([]);
  });

  it('改动行与声明相交时仍会裁决缺少说明的声明', /** 相交判断写反会漏掉本次真实改动。 */ () => {
    const findings = checkWebFile(
      input('/tmp/DUMMY-module.ts', 'export const value = 1;\n', {
        lines: [1],
        new: false,
      }),
    );

    expect(rules(findings)).toContain('web-module-doc');
  });
});

describe('语法诊断', /** 语法错误必须单独成码并阻断后续注释裁决。 */ () => {
  it('脚本语法错误报 web-syntax 且不再产出注释诊断', /** 语法树不可信时继续裁决会产生误导性诊断。 */ () => {
    const findings = checkWebFile(
      input('/tmp/DUMMY-broken.ts', 'export const value = ;\n'),
    );

    expect(rules(findings)).toEqual(['web-syntax']);
    expect(findings[0]?.line).toBeGreaterThanOrEqual(1);
  });

  it('vue 模板语法错误报 vue-syntax', /** 模板错误必须与脚本错误分开，便于调用方分别处理。 */ () => {
    const findings = checkWebFile(
      input('/tmp/DUMMY-broken.vue', '<template><div></template>\n'),
    );

    expect(rules(findings)).toContain('vue-syntax');
  });
});

describe('声明职责注释', /** 显式声明的函数必须能追溯到中文职责说明。 */ () => {
  it('函数缺少任何前置注释时报 web-doc', /** 完全缺失说明会让阅读者只能从实现反推意图。 */ () => {
    const findings = checkWebFile(
      input('/tmp/DUMMY-fn.ts', 'export function run() {\n  return 1;\n}\n'),
    );

    expect(rules(findings)).toContain('web-doc');
  });

  it('公开声明只有行注释时报 web-jsdoc', /** 公开契约要求块注释，行注释无法承载标签。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-fn.ts',
        '// 执行一次操作。\nexport function run() {\n  return 1;\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-jsdoc');
  });

  it('注释与声明之间隔着其它语句时视为没有说明', /** 隔着语句复用旧注释会让注释与实现错配。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-fn.ts',
        '/** 旧说明。 */\nconst other = 1;\nexport function run() {\n  return 1;\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-doc');
  });

  it('注释与声明之间隔着代码时不复用该注释', /** 隔着代码复用旧注释会让注释与实现错配，必须重新要求说明。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-inline-callable.ts',
        'let target;\n/** 旧说明。 */ target = () => 1;\nvoid target;\n',
      ),
    );

    expect(rules(findings)).toContain('web-doc');
  });

  it('多行连续注释被合并为同一份说明', /** 只取最后一段会丢掉职责描述的第一句。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-fn.ts',
        '/**\n * 执行一次操作。\n * @returns 固定值。\n */\nexport function run() {\n  return 1;\n}\n',
      ),
    );

    expect(findings).toEqual([]);
  });

  it('@description 写法被接受为职责说明', /** vben 体系习惯使用该写法，规则必须兼容。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-fn.ts',
        '/** @description 执行一次操作。\n * @returns 固定值。\n */\nexport function run() {\n  return 1;\n}\n',
      ),
    );

    expect(findings).toEqual([]);
  });

  it('导出常量同样需要职责说明', /** 导出常量属于公开契约，缺少说明会让调用方猜测口径。 */ () => {
    const findings = checkWebFile(
      input('/tmp/DUMMY-const.ts', 'export const DEFAULT_NAME = "x";\n'),
    );

    expect(rules(findings)).toContain('web-doc');
  });

  it('接口与类型别名只检查头部', /** 把旧类注释算到方法上会造成无关阻断。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-type.ts',
        '/** 记录结构。 */\ninterface Item {\n  name: string;\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-doc');
  });

  it('接口成员缺少说明时报 web-doc', /** 接口成员的调用契约不能只靠类型名表达。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-type.ts',
        '/** 记录结构。 */\ninterface Item {\n  name: string;\n  run(): void;\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-doc');
  });
});

describe('函数类型与属性承载节点', /** 箭头函数与函数类型的说明挂在变量或属性上，定位错误会漏检。 */ () => {
  it('类型别名里的函数类型按类型别名取注释', /** 承载节点定位错误会把类型别名自身的说明算作函数的说明。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-alias.ts',
        '/** 处理回调。\n * @param value 输入文本。\n * @returns 处理结果。\n */\nexport type Handler = (value: string) => string;\n',
      ),
    );

    expect(findings).toEqual([]);
  });

  it('接口属性里的函数类型按属性签名取注释', /** 属性签名是承载节点，缺失时要求属性本身有说明。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-prop.ts',
        '/** 回调集合。 */\ninterface Events {\n  onReady: (value: string) => void;\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-doc');
  });

  it('变量声明里的箭头函数按变量语句取注释', /** 取错节点会把函数说明绑到语句之外的位置。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-arrow.ts',
        '/** 读取固定值。\n * @returns 固定值。\n */\nexport const read = () => 1;\n',
      ),
    );

    expect(findings).toEqual([]);
  });

  it('对象属性里的函数表达式按属性赋值取注释', /** 对象字面量中的回调同样属于公开契约。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-object.ts',
        '/** 配置集合。 */\nexport const options = {\n  /** 读取固定值。\n   * @returns 固定值。\n   */\n  read: () => 1,\n};\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-doc');
  });

  it('类属性里的箭头函数按属性声明取注释', /** 类字段回调缺少说明会让使用者无法判断触发时机。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-class-field.ts',
        '/** 组件定义。 */\nclass Widget {\n  handle = () => 1;\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-doc');
  });
});

describe('公开性判定', /** 公开性决定是否需要完整 JSDoc 与调用契约标签。 */ () => {
  it('导出函数缺少 JSDoc 时不因行注释放行', /** 公开判定的入口失效会让契约标签整体失效。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-public.ts',
        '// 执行一次操作。\nexport function run() {\n  return 1;\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-jsdoc');
  });

  it('私有方法只需职责说明，不强制 JSDoc', /** 对私有实现强制块注释会制造无意义噪音。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-private.ts',
        '/** 组件定义。 */\nclass Widget {\n  /** 内部计算。 */\n  private compute() {\n    return 1;\n  }\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-jsdoc');
  });

  it('受保护方法按非公开处理但仍需要职责说明', /** 受保护成员同样属于内部实现。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-protected.ts',
        '/** 组件定义。 */\nclass Widget {\n  protected compute() {\n    return 1;\n  }\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-doc');
    expect(rules(findings)).not.toContain('web-jsdoc');
  });

  it('私有标识符方法按非公开处理', /** # 私有方法不应被要求公开契约标签。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-hash.ts',
        '/** 组件定义。 */\nclass Widget {\n  /** 内部计算。 */\n  #compute() {\n    return 1;\n  }\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-jsdoc');
  });

  it('公开方法与访问器需要 JSDoc 块注释', /** 类成员是常见对外契约，行注释不足以承载标签。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-methods.ts',
        '/** 组件定义。 */\nclass Widget {\n  // 读取宽度。\n  get width() {\n    return 1;\n  }\n\n  // 写入宽度。\n  set width(value: number) {\n    void value;\n  }\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-jsdoc');
  });

  it('构造函数按公开成员要求说明', /** 构造函数是实例化契约，缺少说明会让调用方无法判断前置条件。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-ctor.ts',
        '/** 组件定义。 */\nclass Widget {\n  constructor() {\n    void 0;\n  }\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-doc');
  });

  it('调用签名与构造签名按公开声明要求 JSDoc', /** 可调用对象是公开契约，必须能说明参数与返回。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-signature.ts',
        '/** 回调结构。 */\ninterface Callable {\n  // 执行调用。\n  (value: string): void;\n  // 构造实例。\n  new (value: string): Callable;\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-jsdoc');
  });
});

describe('参数标签检查', /** 参数标签是公开契约中最容易与实现分叉的部分。 */ () => {
  it('公开函数缺少参数说明时报 web-param', /** 只描述职责而不描述参数会让调用方猜口径。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-param.ts',
        '/** 执行一次操作。\n * @returns 固定值。\n */\nexport function run(value: string) {\n  return value;\n}\n',
      ),
    );

    expect(findings).toContainEqual({
      line: 4,
      message: 'run 缺少参数 value 的中文说明',
      path: '/tmp/DUMMY-param.ts',
      rule: 'web-param',
    });
  });

  it('参数标签支持类型标记、可选写法与默认值写法', /** 标签写法不兼容会让合法注释被误报为缺失。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-param-style.ts',
        '/** 执行一次操作。\n * @param {string} value - 输入文本。\n * @param [count=1] 重复次数。\n * @returns 固定值。\n */\nexport function run(value: string, count = 1) {\n  return value + String(count);\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-param');
  });

  it('解构参数至少需要一个中文对象说明', /** 解构参数无法按名匹配，必须退化为整体说明。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-destructure.ts',
        '/** 执行一次操作。\n * @returns 固定值。\n */\nexport function run({ value }: { value: string }) {\n  return value;\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-param');
  });

  it('解构参数带有对象说明时通过', /** 合法的整体说明必须被接受。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-destructure-ok.ts',
        '/** 执行一次操作。\n * @param options 调用选项。\n * @returns 固定值。\n */\nexport function run({ value }: { value: string }) {\n  return value;\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-param');
  });

  it('签名中不存在的参数标签报 web-param-stale', /** 过期标签会让注释与真实签名长期分叉。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-stale.ts',
        '/** 执行一次操作。\n * @param removed 已删除的参数。\n * @returns 固定值。\n */\nexport function run() {\n  return 1;\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-param-stale');
  });

  it('解构签名不做逐名过期检查', /** 解构签名无法按直接参数名核对，逐名核对会误报。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-stale-destructure.ts',
        '/** 执行一次操作。\n * @param options 调用选项。\n * @returns 固定值。\n */\nexport function run({ value }: { value: string }) {\n  return value;\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-param-stale');
  });

  it('仅有职责说明的私有函数不触发标签检查', /** 分支数不足的私有函数不应被强制要求契约标签。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-private-param.ts',
        '/** 组件定义。 */\nclass Widget {\n  /** 内部计算。 */\n  private compute(value: string) {\n    return value;\n  }\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-param');
  });
});

describe('返回与异常标签检查', /** 返回与异常是不能靠签名完全表达的调用契约。 */ () => {
  it('有返回值的公开函数缺少返回说明时报 web-returns', /** 缺少返回语义会让调用方无法判断空值约定。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-returns.ts',
        '/** 执行一次操作。 */\nexport function run() {\n  return 1;\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-returns');
  });

  it('返回类型声明为 void 时不要求返回说明', /** 对无返回值函数强制返回标签会制造虚构契约。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-void.ts',
        '/** 执行一次操作。 */\nexport function run(): void {\n  void 0;\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-returns');
  });

  it('返回类型声明为 Promise<void> 时不要求返回说明', /** 空 Promise 不应被当成有返回内容。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-promise-void.ts',
        '/** 执行一次操作。 */\nexport async function run(): Promise<void> {\n  await Promise.resolve();\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-returns');
  });

  it('表达式体箭头函数按返回值判定', /** 简写函数同样会返回值，漏判会让返回契约缺失。 */ () => {
    const findings = checkWebFile(
      input('/tmp/DUMMY-arrow-return.ts', 'export const read = () => 1;\n'),
    );

    expect(rules(findings)).toContain('web-returns');
  });

  it('无返回表达式的 return 不计为返回值', /** 裸 return 不是返回内容，误判会强制虚构返回标签。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-bare-return.ts',
        '/** 执行一次操作。 */\nexport function run(): undefined {\n  return;\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-returns');
  });

  it('构造函数与写访问器不要求返回说明', /** 构造与赋值没有返回语义。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-ctor-returns.ts',
        '/** 组件定义。 */\nclass Widget {\n  /** 构造实例。 */\n  constructor(value: number) {\n    void value;\n  }\n\n  /** 写入宽度。\n   * @param value 新宽度。\n   */\n  set width(value: number) {\n    void value;\n  }\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-returns');
  });

  it('直接抛出异常的函数缺少异常说明时报 web-throws', /** 失败条件是调用方必须知道的契约。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-throws.ts',
        '/** 执行一次操作。 */\nexport function run() {\n  throw new Error("DUMMY-failure");\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-throws');
  });

  it('在 try 块内抛出的异常由自身捕获时不要求异常说明', /** 内部已捕获的异常不是调用方可见的失败条件。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-caught.ts',
        '/** 执行一次操作。 */\nexport function run() {\n  try {\n    throw new Error("DUMMY-failure");\n  } catch {\n    void 0;\n  }\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-throws');
  });

  it('嵌套函数的返回与异常不记到外层函数', /** 嵌套函数有自己的契约，混算会让外层函数被误报。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-nested.ts',
        '/** 执行一次操作。\n * @returns 内部函数。\n */\nexport function run() {\n  return () => {\n    throw new Error("DUMMY-nested-failure");\n  };\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-throws');
  });

  it('分支较多的私有函数同样需要完整契约', /** 复杂内部逻辑的返回与参数说明对维护者同样必要。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-branches.ts',
        '/** 组件定义。 */\nclass Widget {\n  /** 内部计算。 */\n  private compute(value: number) {\n    if (value > 0) {\n      return 1;\n    }\n    if (value < 0) {\n      return -1;\n    }\n    return 0;\n  }\n}\n',
      ),
    );

    expect(rules(findings)).toContain('web-returns');
    expect(rules(findings)).toContain('web-param');
  });
});

describe('vue 单文件组件检查', /** SFC 的脚本块必须按原始行号裁决。 */ () => {
  it('按脚本块偏移换算行号', /** 行号偏移算错会让用户定位到错误的代码行。 */ () => {
    const source = [
      '<template>',
      '  <span>{{ value }}</span>',
      '</template>',
      '',
      '<script setup lang="ts">',
      'export function run() {',
      '  return 1;',
      '}',
      '</script>',
      '',
    ].join('\n');

    const findings = checkWebFile(input('/tmp/DUMMY-sfc.vue', source));

    expect(findings).toContainEqual({
      line: 6,
      message: 'run 缺少中文职责注释',
      path: '/tmp/DUMMY-sfc.vue',
      rule: 'web-doc',
    });
  });

  it('外置脚本被跳过，不尝试加载组件声明的路径', /** 外置脚本由对应文件检查，重复检查会产生重复诊断。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-external.vue',
        '<script src="./external.ts"></script>\n<template><span /></template>\n',
      ),
    );

    expect(findings).toEqual([]);
  });

  it('无脚本组件缺少中文说明时报 vue-component-doc', /** 纯模板组件同样需要业务说明。 */ () => {
    const findings = checkWebFile(
      input('/tmp/DUMMY-template.vue', '<template><span /></template>\n', {
        new: true,
      }),
    );

    expect(findings).toContainEqual({
      line: 1,
      message: '无脚本组件缺少中文职责说明',
      path: '/tmp/DUMMY-template.vue',
      rule: 'vue-component-doc',
    });
  });

  it('无脚本组件带中文 HTML 注释时通过', /** 合法的组件说明必须被接受。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-template-ok.vue',
        '<!-- 展示一个占位文本。 -->\n<template><span /></template>\n',
        { new: true },
      ),
    );

    expect(findings).toEqual([]);
  });

  it('非新增的无脚本组件不检查组件说明', /** 历史文件不因增量检查被整体阻断。 */ () => {
    const findings = checkWebFile(
      input('/tmp/DUMMY-template-old.vue', '<template><span /></template>\n'),
    );

    expect(findings).toEqual([]);
  });
});

describe('脚本语言分派', /** 扩展名决定解析器，分派错误会让合法语法被误判。 */ () => {
  it.each([
    '/tmp/DUMMY-plain.js',
    '/tmp/DUMMY-plain.jsx',
    '/tmp/DUMMY-plain.tsx',
  ])(
    '%s 按脚本文件解析并裁决声明',
    /** JS、JSX 与 TSX 都必须走脚本分支而不是 Vue 分支。 */ (path) => {
      const findings = checkWebFile(
        input(path, 'export function run() {\n  return 1;\n}\n'),
      );

      expect(rules(findings)).toContain('web-doc');
    },
  );

  it('无扩展名的脚本按 TypeScript 解析', /** 兜底语言写错会让合法 TypeScript 语法被误判为语法错误。 */ () => {
    const findings = checkWebFile(
      input(
        '/tmp/DUMMY-noext',
        'export function run(): number {\n  return 1;\n}\n',
      ),
    );

    expect(rules(findings)).not.toContain('web-syntax');
    expect(rules(findings)).toContain('web-doc');
  });
});

describe('声明注释窗口的显式输入', /** 声明起点由调用方显式给出，裁决必须按该起点核对注释是否紧邻声明。 */ () => {
  it('注释紧贴声明时返回该注释原文与说明文字', /** 正常路径的返回值错位会让职责与标签检查整体失效。 */ () => {
    const source =
      'const before = 1;\n/**\n * 执行一次操作。\n * @returns 固定值。\n */\nexport function run() {\n  return 1;\n}\n';
    const tree = ts.createSourceFile(
      'probe.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const declaration = tree.statements[1];
    const start = declaration.getStart(tree);

    // 18 是注释的真实起始字符位置，54 是声明的真实起始字符位置。
    expect(start).toBe(54);
    expect(documentation(declaration, tree, start)).toEqual({
      jsdoc: true,
      raw: '/**\n * 执行一次操作。\n * @returns 固定值。\n */',
      start: 18,
      text: '执行一次操作。\n@returns 固定值。',
    });
  });

  it('注释与声明起点之间隔着代码时返回空说明', /** 隔着语句复用旧注释会让注释与实现错配，必须拒绝该注释。 */ () => {
    const source =
      'const before = 1;\n/* 旧说明。 */ const other = 2;\nexport function run() {\n  return 1;\n}\n';
    const tree = ts.createSourceFile(
      'probe.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    // 注释落在第二条语句的 trivia 里，但本次要取说明的声明在它之后：窗口内含真实代码。
    const commentOwner = tree.statements[1];
    const start = tree.statements[2].getStart(tree);

    expect(documentation(commentOwner, tree, start)).toEqual({
      jsdoc: false,
      raw: '',
      start,
      text: '',
    });
  });

  it('声明起点之前没有候选注释时返回空说明', /** 没有候选注释时必须直接返回空说明，不能把声明之后的注释算进来。 */ () => {
    const source = 'export function run() {\n  return 1;\n}\n';
    const tree = ts.createSourceFile(
      'probe.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const declaration = tree.statements[0];
    const start = declaration.getStart(tree);

    expect(documentation(declaration, tree, start)).toEqual({
      jsdoc: false,
      raw: '',
      start,
      text: '',
    });
  });
});
