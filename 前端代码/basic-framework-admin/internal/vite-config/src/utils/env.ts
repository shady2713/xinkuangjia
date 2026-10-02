import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type EnvValue = string | undefined;

const getBoolean = (value: EnvValue) => value === 'true';
const getNumber = (value: EnvValue, fallback: number) =>
  Number(value) || fallback;
const getString = (value: EnvValue, fallback: string) => value ?? fallback;

function parseEnvContent(content: string) {
  const parsed: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

async function readEnvFiles(root: string, mode?: string) {
  const files = ['.env', '.env.local'];
  if (mode) {
    files.push(`.env.${mode}`, `.env.${mode}.local`);
  }

  const envConfig: Record<string, string> = {};
  for (const file of files) {
    const fullPath = join(root, file);
    if (!existsSync(fullPath)) {
      continue;
    }
    const content = await readFile(fullPath, 'utf8');
    Object.assign(envConfig, parseEnvContent(content));
  }
  return envConfig;
}

async function loadEnv<T extends Record<string, any> = Record<string, string>>(
  root: string,
  mode?: string,
  extraFiles?: string[],
): Promise<T> {
  const envConfig = await readEnvFiles(root, mode);
  if (extraFiles?.length) {
    for (const file of extraFiles) {
      if (!existsSync(file)) {
        continue;
      }
      const content = await readFile(file, 'utf8');
      Object.assign(envConfig, parseEnvContent(content));
    }
  }
  return envConfig as T;
}

/**
 * 加载当前模式的环境变量，并转换构建阶段使用的布尔值与基础参数。
 *
 * @param root 前端工作区根目录
 * @param mode Vite 运行模式
 * @returns 合并并转换后的环境配置
 */
async function loadAndConvertEnv(root: string, mode?: string) {
  const env = await loadEnv<Record<string, string>>(root, mode);
  return {
    ...env,
    base: getString(env.VITE_BASE, '/'),
    injectAppLoading: getBoolean(env.VITE_INJECT_APP_LOADING),
    port: getNumber(env.VITE_PORT, 5173),
  };
}

export { loadAndConvertEnv, loadEnv };
