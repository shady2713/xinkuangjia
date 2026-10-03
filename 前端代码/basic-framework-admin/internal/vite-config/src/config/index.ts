import type { DefineConfig, VbenViteConfig } from '../typing.ts';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineApplicationConfig } from './application.ts';
import { defineLibraryConfig } from './library.ts';

export * from './application.ts';
export * from './library.ts';

/**
 * 按工程类型产出 Vite 配置。
 * @param userConfigPromise 使用方配置；缺省时按类型使用内置配置。
 * @param type 工程类型，auto 会按是否存在 index.html 判定。
 * @returns 解析完成后的 Vite 配置。
 * @throws {Error} 传入的工程类型不在 application 与 library 之列时拒绝。
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
