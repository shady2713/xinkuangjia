/**
 * 动态导入归一化工具（eslint-config/src/util.ts）的真实行为回归。
 *
 * `interopDefault` 负责把打包器互操作后多包一层的 CommonJS 模块还原成模块本身：
 * 有 default 包装时取 default，没有包装时原样返回，并保持 await 后的判定顺序。
 * 用例真实调用该函数并断言两类返回值与边界输入。
 */
import { describe, expect, it } from 'vitest';

import { interopDefault } from './util';

describe('interopDefault 归一化', /** 归一化错误会让动态加载的插件拿到包装对象而不是模块本体。 */ () => {
  it('取出 CommonJS 互操作包装的 default', /** 打包器包装未解开会让插件注册读到 undefined。 */ async () => {
    const moduleBody = { rule: true };

    await expect(interopDefault({ default: moduleBody })).resolves.toBe(
      moduleBody,
    );
  });

  it('没有 default 包装时原样返回', /** 误取不存在的 default 会把模块本体替换成 undefined。 */ async () => {
    const moduleBody = { named: 'value' };

    await expect(interopDefault(moduleBody)).resolves.toBe(moduleBody);
  });

  it('直接传入 Promise 时等待后归一化', /** 未等待 Promise 会读到 Promise 对象而不是模块。 */ async () => {
    const moduleBody = { default: { async: true } };

    await expect(interopDefault(Promise.resolve(moduleBody))).resolves.toEqual({
      async: true,
    });
  });

  it('null 与原始值不被当作包装对象', /** 对 null 取 default 会直接抛错，破坏加载链路。 */ async () => {
    await expect(interopDefault(null)).resolves.toBeNull();
    await expect(interopDefault('plain')).resolves.toBe('plain');
  });
});
