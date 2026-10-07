/** 用真实 Rollup 输出验证第三方许可材料插件：只按产物真正引用的包登记，不写入工程产物。 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { rollup } from 'rollup';

import {
  NOTICES_FILE,
  packageOfModule,
  viteThirdPartyNotices,
} from '../src/plugins/third-party-notices.ts';

/**
 * 在临时目录里造一个最小 node_modules 布局。
 * @param {string} base - 临时根目录。
 * @returns {string} 造的包根目录。
 */
function fixturePackage(base) {
  const location = join(
    base,
    'node_modules/.pnpm/left-pad@1.3.0/node_modules/left-pad',
  );
  mkdirSync(location, { recursive: true });
  writeFileSync(
    join(location, 'package.json'),
    JSON.stringify({
      author: 'azer',
      license: 'MIT',
      name: 'left-pad',
      repository: 'https://github.com/stevemao/left-pad',
      version: '1.3.0',
    }),
  );
  writeFileSync(join(location, 'LICENSE'), 'MIT License\n\nleft pad\n');
  return location;
}

test('模块标识解析出包名与包根', /** 核对真实 pnpm 布局能被识别，识别不出时返回空而不猜包名。 */ () => {
  const base = mkdtempSync(join(tmpdir(), 'bf-license-'));
  try {
    const location = fixturePackage(base);
    const parsed = packageOfModule(
      `${location}/dist/index.js?virtual\u0000ignored`,
    );
    assert.equal(parsed.name, 'left-pad');
    assert.equal(parsed.location, location);
    assert.equal(packageOfModule('/app/src/main.ts').name, '');
  } finally {
    rmSync(base, { force: true, recursive: true });
  }
});

test('材料只登记产物真正引用的包', /** 登记真正被产物引用的包，并核对材料与正文都生成。 */ async () => {
  const base = mkdtempSync(join(tmpdir(), 'bf-license-'));
  try {
    const location = fixturePackage(base);
    writeFileSync(join(location, 'index.js'), 'export default 1;\n');
    writeFileSync(
      join(location, 'entry.js'),
      'import value from "./index.js";\nexport default value;\n',
    );
    const bundle = await rollup({
      input: join(location, 'entry.js'),
      plugins: [viteThirdPartyNotices(resolve('apps/web-ele'))],
    });
    try {
      const { output } = await bundle.generate({ format: 'es' });
      const emitted = output.find(
        /** 取唯一许可材料。 */ (item) => item.fileName === NOTICES_FILE,
      );
      assert.ok(emitted, '必须产出 THIRD-PARTY-NOTICES');
      assert.match(emitted.source, /left-pad@1\.3\.0/);
      assert.match(emitted.source, /许可证声明：MIT/);
      assert.match(emitted.source, /licenses\/[0-9a-f]{16}\.txt/);
      const texts = output.filter(
        /** 只保留去重后的许可证正文文件。 */ (item) =>
          item.fileName?.startsWith('licenses/'),
      );
      assert.equal(texts.length, 1);
      assert.match(texts[0].source, /left pad/);
    } finally {
      await bundle.close();
    }
  } finally {
    rmSync(base, { force: true, recursive: true });
  }
});

test('未声明许可证的包如实写未声明', /** 未声明就写未声明，不套用看似合理的许可证。 */ async () => {
  const base = mkdtempSync(join(tmpdir(), 'bf-license-'));
  try {
    const location = join(base, 'node_modules/plain');
    mkdirSync(location, { recursive: true });
    writeFileSync(
      join(location, 'package.json'),
      JSON.stringify({ name: 'plain', version: '0.1.0' }),
    );
    writeFileSync(join(location, 'index.js'), 'export default 2;\n');
    const bundle = await rollup({
      input: join(location, 'index.js'),
      plugins: [viteThirdPartyNotices(resolve('apps/web-ele'))],
    });
    try {
      const { output } = await bundle.generate({ format: 'es' });
      const emitted = output.find(
        /** 取唯一许可材料。 */ (item) => item.fileName === NOTICES_FILE,
      );
      assert.match(emitted.source, /plain@0\.1\.0/);
      assert.match(emitted.source, /许可证声明：包清单未声明/);
      assert.match(emitted.source, /包内未随附许可证文本文件/);
    } finally {
      await bundle.close();
    }
  } finally {
    rmSync(base, { force: true, recursive: true });
  }
});
