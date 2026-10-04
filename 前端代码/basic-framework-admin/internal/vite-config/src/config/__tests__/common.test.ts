/** 校验 Vite 公共构建配置的真实取值，避免产物开启源码映射或恢复体积告警阈值。 */
import { describe, expect, it } from 'vitest';

import { getCommonConfig } from '../common';

describe('getCommonConfig 公共构建配置', /** 该函数是所有 Vite 应用的构建基线，取值变化会直接影响发布产物。 */ () => {
  it('返回 Promise 形态的配置对象', /** 调用方以 await 消费，同步返回会破坏应用配置的组装顺序。 */ async () => {
    const pending = getCommonConfig();
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).resolves.toBeTypeOf('object');
  });

  it('构建体积与源码映射保持既定口径', /** 阈值 2000、关闭压缩体积上报与 sourcemap 是当前发布约定，不能被静默改写。 */ async () => {
    const config = await getCommonConfig();
    expect(config).toEqual({
      build: {
        chunkSizeWarningLimit: 2000,
        reportCompressedSize: false,
        sourcemap: false,
      },
    });
  });
});
