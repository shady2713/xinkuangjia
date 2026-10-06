/**
 * 构建期环境变量工具：按 .env 系列文件读取并合并键值。
 * 加载顺序为 .env、.env.local、.env.<mode>、.env.<mode>.local，
 * 靠后的文件覆盖同名键，文件缺失直接跳过而不报错。
 * loadAndConvertEnv 另把 base、port 等转成构建参数；
 * 本模块不校验必填项，也不负责注入 import.meta.env。
 */
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

/**
 * 合并并返回指定模式下的环境变量。
 *
 * 按 .env、.env.local、.env.<mode>、.env.<mode>.local 的顺序读取，越靠后的文件覆盖先前的同名键；
 * extraFiles 里的文件最后读取，用于注入构建机上的额外配置。缺失的文件直接跳过，
 * 不存在的路径不视为错误。
 *
 * @param root 工作区根目录
 * @param mode Vite 运行模式，决定加载 .env.<mode> 系列文件
 * @param extraFiles 需要额外合并的绝对路径文件列表
 * @returns 所有来源合并后的键值表；泛型只用于调用方声明期望的键集合
 */
async function loadEnv<
  T extends Record<string, unknown> = Record<string, string>,
>(root: string, mode?: string, extraFiles?: string[]): Promise<T> {
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
