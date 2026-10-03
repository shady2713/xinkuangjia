/**
 * API 选择器声明式映射：把持久化配置限制为字段路径，不提供代码执行能力。
 * @author 李杰
 */

/** API 选择器允许使用的字段映射。 */
export interface ApiSelectMapping {
  labelField: string;
  listPath: string;
  valueField: string;
}

/**
 * 归一化后的选择器选项。
 * @description label 与 value 保留接口返回的原始值，不做字符串化；由 ElOption 负责渲染与选中。
 */
export interface ApiSelectOption {
  label: unknown;
  value: unknown;
}

/** 映射解析结果，并标识是否来自历史白名单语法迁移。 */
export interface ApiSelectMappingResult {
  mapping?: ApiSelectMapping;
  migrated: boolean;
  reason?: string;
}

const MAX_MAPPING_LENGTH = 2000;
const SAFE_PATH_PATTERN = /^[a-z_$][\w$]*(?:\.[a-z_$][\w$]*)*$/i;
const FORBIDDEN_PATH_SEGMENTS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * 解析 API 选择器的声明式映射配置，并兼容历史文档中最简单的 map 写法。
 *
 * 历史配置只能通过白名单语法迁移，任何超出该语法的 JavaScript 都会被拒绝，
 * 从而保证配置数据不会进入动态执行环境。
 *
 * @param source parseFunc 字段中保存的 JSON 或历史 map 表达式
 * @return 可安全执行的字段映射；失败时返回可展示的迁移原因
 */
export function parseApiSelectMapping(source: string): ApiSelectMappingResult {
  const text = source.trim();
  if (!text) {
    return { migrated: false, reason: '映射配置不能为空' };
  }
  if (text.length > MAX_MAPPING_LENGTH) {
    return { migrated: false, reason: '映射配置长度超过 2000 个字符' };
  }

  const jsonResult = parseJsonMapping(text);
  if (jsonResult) {
    return jsonResult;
  }

  const legacyMapping = parseLegacyMapExpression(text);
  if (legacyMapping) {
    return { mapping: legacyMapping, migrated: true };
  }

  return {
    migrated: false,
    reason:
      '仅支持 JSON 字段映射；历史配置只兼容 data.list.map(item => ({ label: item.name, value: item.id })) 形式',
  };
}

/**
 * 根据声明式规则提取选项列表。
 *
 * @param payload 接口返回数据
 * @param mapping 已校验的字段映射
 * @return 标准选择器选项；列表路径不存在时返回 undefined
 */
export function mapApiSelectOptions(
  payload: unknown,
  mapping: ApiSelectMapping,
): ApiSelectOption[] | undefined {
  const list = mapping.listPath
    ? resolveOwnPath(payload, mapping.listPath)
    : payload;
  if (!Array.isArray(list)) {
    return undefined;
  }
  return list.map((item) => ({
    label: resolveOwnPath(item, mapping.labelField),
    value: resolveOwnPath(item, mapping.valueField),
  }));
}

/** 解析 JSON 规则；返回 undefined 表示输入不是 JSON 对象。 */
function parseJsonMapping(text: string): ApiSelectMappingResult | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) {
    return { migrated: false, reason: '映射配置必须是 JSON 对象' };
  }

  const allowedKeys = new Set(['labelField', 'listPath', 'valueField']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return { migrated: false, reason: '映射配置包含不支持的字段' };
  }

  const listPath =
    typeof value.listPath === 'string' ? value.listPath.trim() : '';
  const labelField =
    typeof value.labelField === 'string' ? value.labelField.trim() : '';
  const valueField =
    typeof value.valueField === 'string' ? value.valueField.trim() : '';
  if (!isSafePath(labelField) || !isSafePath(valueField)) {
    return {
      migrated: false,
      reason: 'labelField 或 valueField 不是安全字段路径',
    };
  }
  if (listPath && !isSafePath(listPath)) {
    return { migrated: false, reason: 'listPath 不是安全字段路径' };
  }
  return {
    mapping: { labelField, listPath, valueField },
    migrated: false,
  };
}

/**
 * 仅识别旧配置页面公开过的简单 map 语法，不尝试解释一般 JavaScript。
 * 这是兼容迁移边界，不能扩展为表达式求值器。
 */
function parseLegacyMapExpression(text: string): ApiSelectMapping | undefined {
  const normalized = text.replaceAll(/\s+/gu, '');
  const functionPattern =
    /^function\(data\)\{returndata(?:\.([\w$.]+))?\.map\(item=>\(\{label:item\.([\w$.]+),value:item\.([\w$.]+)\}\)\);?\}$/;
  const arrowPattern =
    /^\(?data\)?=>data(?:\.([\w$.]+))?\.map\(item=>\(\{label:item\.([\w$.]+),value:item\.([\w$.]+)\}\)\);?$/;
  const match =
    normalized.match(functionPattern) ?? normalized.match(arrowPattern);
  if (!match) {
    return undefined;
  }
  const [, listPath = '', labelField = '', valueField = ''] = match;
  if (
    (listPath && !isSafePath(listPath)) ||
    !isSafePath(labelField) ||
    !isSafePath(valueField)
  ) {
    return undefined;
  }
  return { labelField, listPath, valueField };
}

/** 仅沿对象自有属性读取点路径，避免访问原型链上的敏感成员。 */
function resolveOwnPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/** 校验声明式路径，显式阻断原型链相关字段。 */
function isSafePath(path: string): boolean {
  return (
    path.length <= 128 &&
    SAFE_PATH_PATTERN.test(path) &&
    path.split('.').every((segment) => !FORBIDDEN_PATH_SEGMENTS.has(segment))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export { isRecord, resolveOwnPath };
