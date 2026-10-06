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

/** .env 里读到的原始取值：键存在时为字符串，缺失时为 undefined。 */
type EnvValue = string | undefined;

/** 把 .env 中的字符串按严格等于 'true' 解析为布尔值；其它取值（含 '1'）都算 false。 */
const getBoolean = (value: EnvValue) => value === 'true';
/** 把 .env 中的字符串转成数字；无法解析或恰好为 0 时回退到给定的默认值。 */
const getNumber = (value: EnvValue, fallback: number) =>
  Number(value) || fallback;
/** 读取字符串取值；键缺失（undefined）时回退默认值，空串会原样保留。 */
const getString = (value: EnvValue, fallback: string) => value ?? fallback;

/**
 * 解析单个 .env 文件的文本内容。
 * 跳过空行与以 # 开头的注释；缺少 = 或键名为空的行走忽略；值两端成对的引号会被去掉。
 * @param content - .env 文件的原始文本。
 * @returns 键到值的映射；同一个键重复出现时后写的覆盖先写的。
 */
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

/**
 * 依次读取根目录下的 .env 系列文件并合并。
 * 顺序为 .env、.env.local、.env.<mode>、.env.<mode>.local，文件不存在直接跳过。
 * @param root - 读取 .env 文件的目录，一般是前端工作区根目录。
 * @param mode - Vite 运行模式；省略时不读取 .env.<mode> 系列文件。
 * @returns 合并后的键值表，同名键以最后读取到的文件为准。
 */
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
