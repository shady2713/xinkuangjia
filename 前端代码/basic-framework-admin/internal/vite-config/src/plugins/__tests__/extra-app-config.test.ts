/** 验证通用构建运行时配置插件的公开键白名单与显式配置优先策略。 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  getConfigSource,
  pickPublicRuntimeConfig,
  PUBLIC_RUNTIME_CONFIG_KEYS,
} from '../extra-app-config';

const tempDirs: string[] = [];

/**
 * 在系统临时目录创建独立测试应用根目录并登记清理队列。
 *
 * @returns 新建的临时目录绝对路径
 */
async function createTempAppRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'extra-app-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { force: true, recursive: true });
    }
  }
});

describe('viteExtraAppConfigPlugin 回退配置公开键白名单', () => {
  it('pickPublicRuntimeConfig 仅保留公开白名单键并剔除凭据与未知环境变量', () => {
    const selected = pickPublicRuntimeConfig({
      DB_PASSWORD: 'PLACEHOLDER_DB_VALUE',
      INTERNAL_SECRET: 'PLACEHOLDER_SECRET_VALUE',
      VITE_APP_API_ENCRYPT_REQUEST_KEY: 'PLACEHOLDER_REQ_KEY',
      VITE_APP_API_ENCRYPT_RESPONSE_KEY: 'PLACEHOLDER_RES_KEY',
      VITE_APP_DEFAULT_PASSWORD: 'PLACEHOLDER_LOGIN_VALUE',
      VITE_APP_DEFAULT_USERNAME: 'PLACEHOLDER_USER',
      VITE_APP_NAMESPACE: 'demo-app',
      VITE_APP_STORE_SECURE_KEY: 'PLACEHOLDER_STORE_KEY',
      VITE_APP_TITLE: '演示平台',
      VITE_GLOB_API_URL: '/admin-api',
      VITE_UNKNOWN_EXTRA: 'should-drop',
    });

    expect(selected).toEqual({
      VITE_APP_NAMESPACE: 'demo-app',
      VITE_APP_TITLE: '演示平台',
      VITE_GLOB_API_URL: '/admin-api',
    });
    expect(PUBLIC_RUNTIME_CONFIG_KEYS).not.toContain(
      'VITE_APP_DEFAULT_PASSWORD',
    );
    expect(PUBLIC_RUNTIME_CONFIG_KEYS).not.toContain(
      'VITE_APP_DEFAULT_USERNAME',
    );
    expect(PUBLIC_RUNTIME_CONFIG_KEYS).not.toContain(
      'VITE_APP_STORE_SECURE_KEY',
    );
  });

  it('缺少 docker/app.config.js 时回退配置只输出白名单字段且不泄漏非公开环境变量', async () => {
    const root = await createTempAppRoot();
    await writeFile(
      join(root, '.env'),
      [
        'VITE_APP_TITLE=通用应用',
        'VITE_GLOB_API_URL=/admin-api',
        'DB_PASSWORD=PLACEHOLDER_DB_VALUE',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, '.env.production.local'),
      [
        'VITE_APP_DEFAULT_PASSWORD=PLACEHOLDER_LOCAL_VALUE',
        'VITE_APP_STORE_SECURE_KEY=PLACEHOLDER_STORE_KEY',
        'VITE_UPLOAD_TYPE=server',
      ].join('\n'),
      'utf8',
    );

    const source = await getConfigSource(root, 'production');

    expect(source).toContain('"VITE_APP_TITLE":"通用应用"');
    expect(source).toContain('"VITE_GLOB_API_URL":"/admin-api"');
    expect(source).toContain('"VITE_UPLOAD_TYPE":"server"');
    expect(source).not.toContain('DB_PASSWORD');
    expect(source).not.toContain('PLACEHOLDER_DB_VALUE');
    expect(source).not.toContain('VITE_APP_DEFAULT_PASSWORD');
    expect(source).not.toContain('PLACEHOLDER_LOCAL_VALUE');
    expect(source).not.toContain('VITE_APP_STORE_SECURE_KEY');
    expect(source).not.toContain('PLACEHOLDER_STORE_KEY');
    expect(source).toContain('Object.freeze(window._VBEN_ADMIN_PRO_APP_CONF_)');
  });

  it('存在 docker/app.config.js 时优先原样读取显式配置文件', async () => {
    const root = await createTempAppRoot();
    const dockerDir = join(root, 'docker');
    await mkdir(dockerDir, { recursive: true });
    const explicit =
      "window._VBEN_ADMIN_PRO_APP_CONF_ = { VITE_GLOB_API_URL: '/explicit' };\n";
    await writeFile(join(dockerDir, 'app.config.js'), explicit, 'utf8');
    await writeFile(
      join(root, '.env'),
      'VITE_GLOB_API_URL=/fallback\n',
      'utf8',
    );

    const source = await getConfigSource(root, 'production');
    expect(source).toBe(explicit);
  });
});
