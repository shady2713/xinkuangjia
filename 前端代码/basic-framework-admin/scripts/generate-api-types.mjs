/**
 * 从后端契约测试生成的 `src/api/generated/openapi.json` 确定性生成 `api-types.d.ts`。
 *
 * 用法：
 * - `node ./scripts/generate-api-types.mjs` 更新声明文件
 * - `node ./scripts/generate-api-types.mjs --check` 校验声明文件与快照完全同步
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const openApiPath = resolve(projectRoot, 'src/api/generated/openapi.json');
const targetDtsPath = resolve(projectRoot, 'src/api/generated/api-types.d.ts');
const isCheckMode = process.argv.includes('--check');

function sanitizeDoc(text) {
  return String(text).replaceAll('*/', '* /').replaceAll(/\r?\n/gu, ' ').trim();
}

function formatPropertyKey(name) {
  return /^[A-Za-z_$][\w$]*$/u.test(name) ? name : JSON.stringify(name);
}

function renderTsType(schema) {
  if (!schema || typeof schema !== 'object') {
    return 'unknown';
  }
  if (typeof schema.$ref === 'string') {
    const prefix = '#/components/schemas/';
    if (schema.$ref.startsWith(prefix)) {
      return `OpenApiSchemas.${schema.$ref.slice(prefix.length)}`;
    }
    return 'unknown';
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  }
  switch (schema.type) {
    case 'array': {
      const itemType = renderTsType(schema.items);
      const needsParens = itemType.includes(' | ');
      return `${needsParens ? `(${itemType})` : itemType}[]`;
    }
    case 'boolean':
      return 'boolean';
    case 'integer':
      if (
        schema.format === 'int64' &&
        schema['x-java-type'] !== 'LocalDateTime-epoch-ms'
      ) {
        return 'number | string';
      }
      return 'number';
    case 'number':
      return 'number';
    case 'object': {
      if (schema.properties && Object.keys(schema.properties).length > 0) {
        const reqSet = schema.required ? new Set(schema.required) : new Set();
        const entries = Object.keys(schema.properties)
          .toSorted()
          .map((propName) => {
            const opt = reqSet.has(propName) ? '' : '?';
            return `${formatPropertyKey(propName)}${opt}: ${renderTsType(schema.properties[propName])};`;
          });
        return `{ ${entries.join(' ')} }`;
      }
      if (schema.additionalProperties) {
        return `Record<string, ${renderTsType(schema.additionalProperties)}>`;
      }
      return 'Record<string, unknown>';
    }
    case 'string':
      return schema.format === 'binary' ? 'Blob | File' : 'string';
    default:
      return 'unknown';
  }
}

function generateDeclarationContent(spec) {
  const lines = [
    '// 自动由 scripts/generate-api-types.mjs 根据 openapi.json 生成，禁止手改。',
    '',
    'export namespace OpenApiSchemas {',
  ];

  const schemas = spec?.components?.schemas ?? {};
  for (const name of Object.keys(schemas).toSorted()) {
    const schema = schemas[name];
    if (schema?.description) {
      lines.push(`  /** ${sanitizeDoc(schema.description)} */`);
    }
    const properties = schema?.properties ?? {};
    const propNames = Object.keys(properties).toSorted();
    const requiredSet = schema?.required ? new Set(schema.required) : new Set();
    if (propNames.length === 0) {
      lines.push(`  export type ${name} = Record<string, unknown>;`, '');
      continue;
    }
    lines.push(`  export interface ${name} {`);
    for (const propName of propNames) {
      const propSchema = properties[propName];
      if (propSchema?.description) {
        lines.push(`    /** ${sanitizeDoc(propSchema.description)} */`);
      }
      const optionalMark = requiredSet.has(propName) ? '' : '?';
      lines.push(
        `    ${formatPropertyKey(propName)}${optionalMark}: ${renderTsType(propSchema)};`,
      );
    }
    lines.push('  }', '');
  }
  lines.push('}', '', 'export interface OpenApiPaths {');

  const paths = spec?.paths ?? {};
  for (const routePath of Object.keys(paths).toSorted()) {
    const methods = paths[routePath] ?? {};
    lines.push(`  ${JSON.stringify(routePath)}: {`);
    for (const verb of Object.keys(methods).toSorted()) {
      const op = methods[verb] ?? {};
      if (op.summary) {
        lines.push(`    /** ${sanitizeDoc(op.summary)} */`);
      }
      const queryParams = (op.parameters ?? []).filter((p) => p.in === 'query');
      let queryType = 'never';
      if (queryParams.length > 0) {
        const qFields = queryParams
          .map((p) => {
            const opt = p.required ? '' : '?';
            return `${formatPropertyKey(p.name)}${opt}: ${renderTsType(p.schema)}`;
          })
          .join('; ');
        queryType = `{ ${qFields} }`;
      }
      const bodyContent = op.requestBody?.content ?? {};
      const jsonBodySchema =
        bodyContent['application/json']?.schema ??
        bodyContent['multipart/form-data']?.schema;
      const bodyType = jsonBodySchema ? renderTsType(jsonBodySchema) : 'never';
      const respSchema =
        op.responses?.['200']?.content?.['application/json']?.schema;
      const respType = respSchema ? renderTsType(respSchema) : 'void';
      lines.push(
        `    ${verb}: { body: ${bodyType}; query: ${queryType}; response: ${respType} };`,
      );
    }
    lines.push('  };');
  }
  lines.push('}', '');
  return lines.join('\n');
}

function main() {
  if (!existsSync(openApiPath)) {
    throw new Error(`未找到 OpenAPI 契约快照：${openApiPath}`);
  }
  const spec = JSON.parse(readFileSync(openApiPath, 'utf8'));
  const expected = generateDeclarationContent(spec);

  if (isCheckMode) {
    if (!existsSync(targetDtsPath)) {
      console.error('OpenAPI TypeScript 类型文件不存在，请执行 pnpm api:gen 生成。');
      process.exitCode = 1;
      return;
    }
    const actual = readFileSync(targetDtsPath, 'utf8').replaceAll('\r\n', '\n');
    if (actual !== expected) {
      console.error('src/api/generated/api-types.d.ts 与 openapi.json 不一致，请执行 pnpm api:gen 同步。');
      process.exitCode = 1;
      return;
    }
    console.log('OpenAPI TypeScript 契约类型检查通过');
    return;
  }

  writeFileSync(targetDtsPath, expected, 'utf8');
  console.log(`已生成 OpenAPI TypeScript 契约类型：${targetDtsPath}`);
}

main();
