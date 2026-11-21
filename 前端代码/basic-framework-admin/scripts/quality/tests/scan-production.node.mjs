/** 校验生产安全扫描对运行时配置的缺失字段、合法空值与解析失败区分能力。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  inspectRuntimeConfigSource,
  readRuntimeConfigField,
  validateRuntimeConfigContent,
} from '../scan-production.mjs';

const VALID_CONFIG = `
window._VBEN_ADMIN_PRO_APP_CONF_ = {
  VITE_GLOB_API_URL: '/admin-api',
  VITE_APP_DEFAULT_USERNAME: '',
  VITE_APP_DEFAULT_PASSWORD: '',
};
Object.freeze(window._VBEN_ADMIN_PRO_APP_CONF_);
`;

test('合法空字符串凭据与有效相对接口地址通过校验', /** 验证标准空值不会被误报。 */ () => {
  const findings = [];
  validateRuntimeConfigContent(VALID_CONFIG, 'app.config.js', findings);
  assert.deepEqual(findings, []);

  const parsed = inspectRuntimeConfigSource(VALID_CONFIG);
  assert.equal(parsed.ok, true);
  assert.deepEqual(
    readRuntimeConfigField(parsed, 'VITE_APP_DEFAULT_PASSWORD'),
    {
      status: 'ok',
      value: '',
    },
  );
});

test('缺失必填字段时明确报告 missing 而非回退为空字符串', /** 验证删除凭据或接口字段不会静默放行。 */ () => {
  const missingFieldConfig = `
  window._VBEN_ADMIN_PRO_APP_CONF_ = {
    VITE_GLOB_API_URL: '/admin-api',
    VITE_APP_DEFAULT_USERNAME: '',
  };
  `;
  const parsed = inspectRuntimeConfigSource(missingFieldConfig);
  assert.equal(
    readRuntimeConfigField(parsed, 'VITE_APP_DEFAULT_PASSWORD').status,
    'missing',
  );

  const findings = [];
  validateRuntimeConfigContent(missingFieldConfig, 'app.config.js', findings);
  assert.ok(
    findings.some((item) =>
      item.includes('缺少必填字段 VITE_APP_DEFAULT_PASSWORD'),
    ),
    `应报缺失字段，实际：${findings.join('; ')}`,
  );
});

test('语法错误或非静态字符串表达式报告解析失败', /** 防止注释破坏、动态拼接或语法损坏静默通过门禁。 */ () => {
  const brokenSyntax =
    'window._VBEN_ADMIN_PRO_APP_CONF_ = { VITE_GLOB_API_URL: };';
  const syntaxFindings = [];
  validateRuntimeConfigContent(brokenSyntax, 'app.config.js', syntaxFindings);
  assert.ok(
    syntaxFindings.some((item) => item.includes('运行时配置解析失败')),
    `应报语法解析失败，实际：${syntaxFindings.join('; ')}`,
  );

  const dynamicExpression = `
  window._VBEN_ADMIN_PRO_APP_CONF_ = {
    VITE_GLOB_API_URL: '/admin-api',
    VITE_APP_DEFAULT_USERNAME: '',
    VITE_APP_DEFAULT_PASSWORD: window.location.hostname,
  };
  `;
  const dynamicFindings = [];
  validateRuntimeConfigContent(
    dynamicExpression,
    'app.config.js',
    dynamicFindings,
  );
  assert.ok(
    dynamicFindings.some((item) =>
      item.includes('字段 VITE_APP_DEFAULT_PASSWORD 解析失败'),
    ),
    `应报动态表达式解析失败，实际：${dynamicFindings.join('; ')}`,
  );
});

test('本机接口地址与非空默认凭据被阻断', /** 验证非空开发地址与预填凭据被准确拦截。 */ () => {
  const unsafeConfig = `
  window._VBEN_ADMIN_PRO_APP_CONF_ = {
    VITE_GLOB_API_URL: 'http://localhost:48080/admin-api',
    VITE_APP_DEFAULT_USERNAME: 'PLACEHOLDER_USER',
    VITE_APP_DEFAULT_PASSWORD: 'PLACEHOLDER_VALUE',
  };
  `;
  const findings = [];
  validateRuntimeConfigContent(unsafeConfig, 'app.config.js', findings);
  assert.ok(findings.some((item) => item.includes('默认 API 地址指向本机')));
  assert.ok(findings.some((item) => item.includes('不应预填登录用户名')));
  assert.ok(findings.some((item) => item.includes('不应预填登录密码')));
});
