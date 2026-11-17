import type { DefineConfig, VbenViteConfig } from '../typing.ts';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineApplicationConfig } from './application.ts';
import { defineLibraryConfig } from './library.ts';

export * from './application.ts';
export * from './library.ts';

/**
 * 按项目类型生成 Vite 配置。
 * @param userConfigPromise 业务侧可选的 Vite 配置或异步工厂
 * @param type 项目类型；auto 时根据是否存在 index.html 判断
 * @returns 对应应用或库的 Vite 配置
 * @throws 传入不受支持的项目类型时抛出错误
 */
function defineConfig(
  userConfigPromise?: DefineConfig,
  type: 'application' | 'auto' | 'library' = 'auto',
): VbenViteConfig {
  let projectType = type;

  if (projectType === 'auto') {
    const htmlPath = join(process.cwd(), 'index.html');
    projectType = existsSync(htmlPath) ? 'application' : 'library';
  }

  switch (projectType) {
    case 'application': {
      return defineApplicationConfig(userConfigPromise);
    }
    case 'library': {
      return defineLibraryConfig(userConfigPromise);
    }
    default: {
      throw new Error(`Unsupported project type: ${projectType}`);
    }
  }
}

export { defineConfig };
