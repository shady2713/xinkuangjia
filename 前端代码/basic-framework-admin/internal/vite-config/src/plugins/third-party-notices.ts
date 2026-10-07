/**
 * 第三方许可材料插件（生产构建）：按**本次产物实际包含的模块**生成第三方许可材料。
 *
 * 依赖锁文件登记的是全部已解析依赖（含构建期与开发期），不等于交付物包含的组件；本插件改用
 * Rollup 输出的分块模块表反推运行期闭包：只有真正进入产物的第三方包才会出现在材料里。
 * 每个包登记名称、版本、`package.json` 声明的许可证、仓库地址与许可证原文位置；许可证正文按
 * 内容摘要去重后写入 `licenses/` 目录，本文件按摘要引用，避免同一份 Apache 文本重复上百次。
 *
 * 插件不判断"是否合规"，也不为任何包补写声明：读不到 `license` 字段就如实写"未声明"。
 *
 * 除随包材料外，插件还把每个分块的原始模块标识写进构建缓存目录的 `license-closure.json`：
 * 压缩后的产物不再保留模块标识，产物字节本身无法反推包闭包，留痕才能让交付物实查门禁
 * 用**自己的**解析实现重算一遍。该文件不随交付包分发。
 */
import type {
  NormalizedOutputOptions,
  OutputBundle,
  OutputChunk,
  PluginContext,
} from 'rollup';
import type { PluginOption } from 'vite';

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

import { workspaceLicensePath } from './license.ts';

/** 随包输出的第三方许可材料文件名。 */
const NOTICES_FILE = 'THIRD-PARTY-NOTICES';
/** 许可证正文目录，文件名为内容摘要短前缀。 */
const LICENSES_DIR = 'licenses';
/** 单份许可证正文的读取上限，避免异常大的包把产物撑爆。 */
const MAX_TEXT_BYTES = 512 * 1024;
/** 闭包记录文件名：只写到构建缓存目录，不随交付包分发。 */
const CLOSURE_FILE = 'license-closure.json';
/** 闭包记录结构版本；交付物实查门禁按同一版本读取，结构变了就拒绝复用旧记录。 */
const CLOSURE_SCHEMA = 'web-license-closure/v1';
/** 闭包记录相对应用根目录的位置：`<前端工作区>/.cache/build-record`，该目录已在 Git 忽略内。 */
const CLOSURE_DIRECTORY = ['..', '..', '.cache', 'build-record'];
/** 交付产物目录名；只有写入该目录的构建才写闭包记录。 */
const DELIVERABLE_DIRECTORY = 'dist';
/** 许可证正文文件名：匹配 LICENSE/LICENCE/COPYING/NOTICE 开头，不区分大小写。 */
const LICENSE_FILE_PATTERN = /^(?:licen[sc]e|copying|notice)/iu;

/** 一个第三方包在本次构建中的登记信息。 */
interface PackageRecord {
  /** 声明的作者或版权行。 */
  author: string;
  /** `package.json` 声明的许可证；读不到时为空串。 */
  license: string;
  /** 命中的许可证文本文件绝对路径。 */
  licenseFiles: string[];
  /** 包根目录绝对路径。 */
  location: string;
  /** 包名。 */
  name: string;
  /** 仓库或主页地址。 */
  repository: string;
  /** 版本。 */
  version: string;
}

/**
 * 把模块标识里的 `node_modules` 段拆成包根目录与包名。
 *
 * pnpm 的隔离布局形如 `<工作区>/node_modules/.pnpm/<名字>@<版本>/node_modules/<名字>/…`，
 * 取最后一个 `node_modules` 之后的目录作为包根；识别不出时返回空对象而不是猜一个包名。
 *
 * @param id Rollup 模块标识。
 * @returns 包名与包根目录；识别不出时返回空对象。
 */
function packageOfModule(id: string): { location: string; name: string } {
  const path = id.split('\0')[0]?.replaceAll('\\', '/');
  if (!path) {
    return { location: '', name: '' };
  }
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  if (index === -1) {
    return { location: '', name: '' };
  }
  const rest = path.slice(index + marker.length);
  const segments = rest.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { location: '', name: '' };
  }
  const name =
    segments[0]?.startsWith('@') && segments.length > 1
      ? `${segments[0]}/${segments[1]}`
      : (segments[0] ?? '');
  const depth = name.startsWith('@') ? 2 : 1;
  const location = path.slice(
    0,
    index + marker.length + segments.slice(0, depth).join('/').length,
  );
  return { location, name };
}

/**
 * 规范化包清单里"字符串或对象"两种写法的声明字段。
 *
 * `author`、`repository` 在 npm 清单里既可直接写成字符串，也可写成带 `name`/`url` 的对象；
 * 其它字段只有字符串写法。取不到值时返回空串，登记信息因此如实反映"清单未声明"，
 * 不会套用看似合理的默认值。
 *
 * @param value 清单里的原始字段值，类型未受约束。
 * @param key 对象写法下要取的键；直接写字符串时不传。
 * @returns 规范化后的文本；字段缺失或不是字符串/对象时为空串。
 */
function declaredText(value: unknown, key?: string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (key !== undefined && typeof value === 'object' && value !== null) {
    const nested = (value as Record<string, unknown>)[key];
    return typeof nested === 'string' ? nested : '';
  }
  return '';
}

/**
 * 读取包清单中的许可证、作者与仓库地址。
 * @param location 包根目录。
 * @returns 声明字段；清单不存在或无法解析时返回空字段。
 */
function readManifest(location: string): {
  author: string;
  license: string;
  repository: string;
  version: string;
} {
  const manifest = join(location, 'package.json');
  if (!existsSync(manifest)) {
    return { author: '', license: '', repository: '', version: '' };
  }
  try {
    const document = JSON.parse(readFileSync(manifest, 'utf8')) as Record<
      string,
      unknown
    >;
    return {
      author: declaredText(document.author, 'name'),
      license: declaredText(document.license),
      repository: declaredText(document.repository, 'url'),
      version: declaredText(document.version),
    };
  } catch {
    return { author: '', license: '', repository: '', version: '' };
  }
}

/**
 * 列出包根目录下自带的许可证文本文件。
 * @param location 包根目录。
 * @returns 命中的文件绝对路径；目录不可读时返回空列表。
 */
function licenseFilesOf(location: string): string[] {
  if (!existsSync(location)) {
    return [];
  }
  try {
    return readdirSync(location, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && LICENSE_FILE_PATTERN.test(basename(entry.name)),
      )
      .map((entry) => join(location, entry.name))
      .toSorted();
  } catch {
    return [];
  }
}

/**
 * 汇总本次产物真正引用到的第三方包。
 * @param bundle Rollup 输出集合。
 * @returns 以包名为键的登记信息。
 */
function collectPackages(bundle: OutputBundle): Map<string, PackageRecord> {
  const packages = new Map<string, PackageRecord>();
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') {
      continue;
    }
    const chunk = output as OutputChunk;
    for (const id of Object.keys(chunk.modules)) {
      const { location, name } = packageOfModule(id);
      if (!name || packages.has(name)) {
        continue;
      }
      const manifest = readManifest(location);
      packages.set(name, {
        author: manifest.author,
        license: manifest.license,
        licenseFiles: licenseFilesOf(location),
        location,
        name,
        repository: manifest.repository,
        version: manifest.version,
      });
    }
  }
  return packages;
}

/**
 * 生成第三方许可材料正文。
 * @param records 包登记信息。
 * @param texts 摘要到正文内容的映射。
 * @param applicationName 应用名称。
 * @param licenseOrigin 工作区许可证原文路径。
 * @returns 完整正文。
 */
function renderNotices(
  records: PackageRecord[],
  texts: Map<string, string>,
  applicationName: string,
  licenseOrigin: string,
): string {
  const lines: string[] = [
    'THIRD-PARTY-NOTICES',
    '====================',
    '',
    `适用产物：${applicationName}`,
    `本次构建实际包含的第三方包：${records.length} 个`,
    '',
    '本文件只登记本次构建产物中实际出现的第三方包及其许可证声明与原文位置，' +
      '不构成合规结论，也不代表任何许可选择已获批准；' +
      '本项目自有代码的许可由有权者另行决定，本文件不构成对自有代码的许可授予。',
    '',
    '范围口径：清单来自本次 Rollup 产物的分块模块表，' +
      '只有真正进入产物的第三方包才会登记；' +
      '依赖锁文件登记的构建期与开发期依赖不在本文件范围内。',
    '',
    '一、第三方包',
    '',
  ];
  for (const record of records) {
    lines.push(
      `--- ${record.name}@${record.version || '未知版本'} ---`,
      `许可证声明：${record.license || '包清单未声明'}`,
    );
    if (record.author !== '') {
      lines.push(`声明作者：${record.author}`);
    }
    if (record.repository !== '') {
      lines.push(`声明仓库：${record.repository}`);
    }
    lines.push(`安装位置：${record.location.split(sep).slice(-4).join('/')}`);
    if (record.licenseFiles.length === 0) {
      lines.push(
        '许可证原文位置：包内未随附许可证文本文件；条款地址见包清单声明。',
      );
    } else {
      lines.push('许可证原文位置：');
      for (const file of record.licenseFiles) {
        const digest = texts.get(file);
        lines.push(
          digest === undefined
            ? `  ${basename(file)}：未收录`
            : `  ${basename(file)} → ${LICENSES_DIR}/${digest}.txt`,
        );
      }
    }
    lines.push('');
  }
  lines.push(
    '二、工作区许可证原文',
    '',
    licenseOrigin === ''
      ? '工作区根目录未找到 LICENSE 原文，产物不提供该文件。'
      : '产物根目录的 LICENSE 逐字取自工作区根目录已有的同名文件，' +
          '该文件是继承自上游工作区的许可证文本，只覆盖继承来的前端代码，不覆盖本项目新增代码。',
    '',
    '三、生成方式',
    '',
    '本文件由 internal/vite-config 的 viteThirdPartyNotices 插件在生产构建时生成，' +
      '内容只来自本次产物实际引用的包目录与其包清单，不含任何人工补写的条款。',
    '',
  );
  return lines.join('\n');
}

/**
 * 把本次产物每个分块实际包含的模块标识留痕到构建缓存目录。
 *
 * 压缩后的静态产物不再保留模块标识，产物字节本身无法反推"哪些包真的进入了产物"，
 * 因此这里按分块原样写出 Rollup 的模块标识；交付物实查门禁用自己的解析实现重算包集合，
 * 再与随包材料比对。记录写在 `.cache` 下，不进入交付包，也不携带任何人工补写内容。
 *
 * **只记录真正写入交付目录的那次构建**：`bundle.generate()` 的内存构建没有输出目录，
 * 分析或测试用的临时输出目录也不是交付物。若不区分，一次内存构建就会把记录覆盖成别的
 * 分块集合，交付物实查门禁随即把"材料与产物不是同一批"判成失败。
 *
 * @param bundle 本次构建的产物集合。
 * @param root 应用根目录。
 * @param options Rollup 归一化后的输出选项，用于判断本次构建是否写入交付目录。
 */
function writeClosureRecord(
  bundle: OutputBundle,
  root: string,
  options: NormalizedOutputOptions,
): void {
  if (
    options.dir === undefined ||
    resolve(options.dir) !== resolve(root, DELIVERABLE_DIRECTORY)
  ) {
    return;
  }
  const chunks: Record<string, string[]> = {};
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') {
      continue;
    }
    const chunk = output as OutputChunk;
    chunks[chunk.fileName] = Object.keys(chunk.modules);
  }
  const directory = join(root, ...CLOSURE_DIRECTORY);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, CLOSURE_FILE),
    `${JSON.stringify({ schema: CLOSURE_SCHEMA, chunks }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * 构造第三方许可材料插件。
 * @param root 应用根目录。
 * @returns 生产构建使用的 Vite 插件。
 */
function viteThirdPartyNotices(root = process.cwd()): PluginOption {
  return {
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      /**
       * 按产物模块汇总第三方包并输出许可材料。
       * @param options - Rollup 传入的输出选项；仅用于判断本次构建是否写入交付目录。
       * @param bundle - 本次构建的产物集合。
       * @this - Rollup 插件上下文，用于把材料输出为静态资源。
       */
      handler(
        this: PluginContext,
        options: NormalizedOutputOptions,
        bundle: OutputBundle,
      ) {
        const records = [...collectPackages(bundle).values()].toSorted(
          /**
           * 按包名升序排列，使同一批依赖每次构建都产出同样顺序的材料。
           * @param left - 左侧包记录。
           * @param right - 右侧包记录。
           * @returns 包名的比较结果。
           */
          (left, right) => left.name.localeCompare(right.name),
        );
        const texts = new Map<string, string>();
        for (const record of records) {
          for (const file of record.licenseFiles) {
            const digest = digestOfFile(file);
            if (digest !== '' && !texts.has(file)) {
              texts.set(file, digest);
            }
          }
        }
        const emitted = new Set<string>();
        for (const [file, digest] of texts) {
          if (emitted.has(digest)) {
            continue;
          }
          emitted.add(digest);
          this.emitFile({
            fileName: `${LICENSES_DIR}/${digest}.txt`,
            source: readFileSync(file, 'utf8').slice(0, MAX_TEXT_BYTES),
            type: 'asset',
          });
        }
        this.emitFile({
          fileName: NOTICES_FILE,
          source: renderNotices(
            records,
            texts,
            '管理前端静态站点',
            workspaceLicensePath(root),
          ),
          type: 'asset',
        });
        writeClosureRecord(bundle, root, options);
      },
      order: 'post',
    },
    name: 'vite:third-party-notices',
  };
}

/**
 * 计算许可证文本文件的内容摘要短前缀；读不到时返回空串。
 * @param file 许可证文本文件路径。
 * @returns 十六进制摘要前 16 位；读取失败时为空串。
 */
function digestOfFile(file: string): string {
  try {
    return createHash('sha256')
      .update(readFileSync(file))
      .digest('hex')
      .slice(0, 16);
  } catch {
    return '';
  }
}

export {
  CLOSURE_FILE,
  CLOSURE_SCHEMA,
  collectPackages,
  LICENSES_DIR,
  NOTICES_FILE,
  packageOfModule,
  viteThirdPartyNotices,
  writeClosureRecord,
};
export type { PackageRecord };
