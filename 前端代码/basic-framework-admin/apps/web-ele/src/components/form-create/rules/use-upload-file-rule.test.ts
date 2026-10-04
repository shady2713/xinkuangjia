/**
 * 文件上传组件设计器规则（components/form-create/rules/use-upload-file-rule）真实行为回归。
 *
 * 表单设计器用它生成"文件上传"组件的注册项：rule() 决定画布上生成的字段名与默认属性，
 * props() 决定右侧属性面板展示哪些配置行以及中文文案。字段名重复会让同一表单的两个
 * 上传控件互相覆盖取值；文件类型、大小与数量限制的默认值写错会让新拖入的控件带上与
 * 业务预期不符的限制；属性面板文案未国际化会整列显示语言键。用例只使用真实规则实现与
 * 真实 helpers，不替换任何被测实现。
 */
import type {
  FormCreatePropsContext,
  FormCreatePropsRule,
} from '#/components/form-create/typing';

import { describe, expect, it, vi } from 'vitest';

import { useUploadFileRule } from './use-upload-file-rule';

/** 文件上传组件名，与设计器注册项声明的 name 保持一致。 */
const FILE_NAME = 'FileUpload';

/** 属性面板请求的组件前缀，用于拼接 components.<prefix>.<field> 语言键。 */
const PROPS_PREFIX = `${FILE_NAME}.props`;

/**
 * 构造设计器上下文，翻译函数按请求的键回显，便于核对真实请求的语言键。
 * @returns 含 t 翻译函数的设计器上下文。
 */
function propsContext(): FormCreatePropsContext {
  return {
    /** 把语言键回显成带前缀的译文，便于核对请求的键。 */
    t: (message: string) => `译文:${message}`,
  };
}

/**
 * 从属性面板配置行中取出指定字段的一行。
 * @param rows 属性面板配置行数组。
 * @param field 目标字段名。
 * @returns 命中的配置行；没有该字段时返回 undefined。
 */
function findRow(rows: FormCreatePropsRule[], field: string) {
  return rows.find(
    /** 只挑出目标字段的配置行，其余行与本断言无关。 */ (row) =>
      row.field === field,
  );
}

/**
 * 取出属性面板配置行的选项列表。
 * @param rule 目标配置行。
 * @returns 选项列表；该行没有声明选项时返回空数组。
 */
function ruleOptions(rule: FormCreatePropsRule | undefined) {
  const options = rule?.options;
  return Array.isArray(options)
    ? (options as Array<{ label?: unknown; value?: unknown }>)
    : [];
}

describe('文件上传规则生成', /** rule() 的字段名与默认属性决定画布上控件的真实取值。 */ () => {
  it('生成字段名唯一的上传规则', /** 字段名重复会让同一表单的两个上传控件互相覆盖取值。 */ () => {
    const rule = useUploadFileRule().rule();
    const another = useUploadFileRule().rule();

    expect(rule.type).toBe(FILE_NAME);
    expect(rule.title).toBe('文件上传');
    expect(rule.info).toBe('');
    expect(rule.$required).toBe(false);
    expect(rule.field).toMatch(/^[\da-f]{32}$/u);
    expect(rule.field).not.toBe(another.field);
  });

  it('注册项透传图标与名称', /** 图标或名称写错会让设计器找不到组件或显示错误图标。 */ () => {
    const registration = useUploadFileRule();

    expect(registration.icon).toBe('icon-upload');
    expect(registration.label).toBe('文件上传');
    expect(registration.name).toBe(FILE_NAME);
  });
});

describe('文件上传属性面板', /** props() 决定面板展示哪些配置行及其文案，直接面向使用者。 */ () => {
  it('必填行在首位且使用固定的必填字段', /** 必填行位置或字段名变化会让设计器识别不到必填开关。 */ () => {
    const rows = useUploadFileRule().props(FILE_NAME, propsContext());

    expect(rows[0]?.field).toBe('formCreate$required');
    expect(rows[0]?.type).toBe('Required');
    expect(rows[0]?.title).toBe('译文:props.required');
  });

  it('暴露文件类型、上传时机、拖拽与提示开关', /** 缺少这些行会让使用者无法在设计器里配置上传行为。 */ () => {
    const rows = useUploadFileRule().props(FILE_NAME, propsContext());

    expect(findRow(rows, 'fileType')).toMatchObject({
      type: 'select',
      value: ['doc', 'xls', 'ppt', 'txt', 'pdf'],
    });
    expect(findRow(rows, 'fileType')?.props).toEqual({ multiple: true });
    expect(findRow(rows, 'autoUpload')).toMatchObject({
      type: 'switch',
      value: true,
    });
    expect(findRow(rows, 'drag')).toMatchObject({
      type: 'switch',
      value: false,
    });
    expect(findRow(rows, 'isShowTip')).toMatchObject({
      type: 'switch',
      value: true,
    });
  });

  it('文件类型选项与默认值一一对应', /** 选项缺项会让使用者选不到已声明支持的类型。 */ () => {
    const rows = useUploadFileRule().props(FILE_NAME, propsContext());
    const options = ruleOptions(findRow(rows, 'fileType'));

    expect(
      options.map(/** 取出选项值用于与默认值比对。 */ (item) => item.value),
    ).toEqual(['doc', 'xls', 'ppt', 'txt', 'pdf']);
    expect(
      options.map(/** 取出选项文案用于核对与值一致。 */ (item) => item.label),
    ).toEqual(['doc', 'xls', 'ppt', 'txt', 'pdf']);
  });

  it('大小与数量限制给出可用的默认值与非负下限', /** 默认值缺失会让新控件不带限制，负下限会生成非法配置。 */ () => {
    const rows = useUploadFileRule().props(FILE_NAME, propsContext());

    expect(findRow(rows, 'fileSize')).toMatchObject({
      type: 'inputNumber',
      value: 5,
      props: { min: 0 },
    });
    expect(findRow(rows, 'limit')).toMatchObject({
      type: 'inputNumber',
      value: 5,
      props: { min: 0 },
    });
  });

  it('提供是否禁用的开关且默认可用', /** 缺少禁用开关会让使用者无法在设计器里锁定控件。 */ () => {
    const rows = useUploadFileRule().props(FILE_NAME, propsContext());

    expect(findRow(rows, 'disabled')).toMatchObject({
      type: 'switch',
      value: false,
    });
  });

  it('按组件前缀与字段名请求翻译文案', /** 语言键前缀写错会让属性面板整列显示成键名。 */ () => {
    const translate = vi.fn(
      /** 记录并回显被请求的语言键。 */ (message: string) => `译文:${message}`,
    );

    const rows = useUploadFileRule().props('IgnoredName', { t: translate });

    expect(translate).toHaveBeenCalledWith('props.required');
    expect(translate).toHaveBeenCalledWith(
      `components.${PROPS_PREFIX}.fileType`,
    );
    expect(findRow(rows, 'fileType')?.title).toBe(
      `译文:components.${PROPS_PREFIX}.fileType`,
    );
  });

  it('翻译缺失时保留中文兜底文案', /** 语言包缺键时面板仍要显示可读中文，不能变成空标题。 */ () => {
    const rows = useUploadFileRule().props(FILE_NAME, {
      /** 模拟语言包缺键：翻译结果为空串。 */
      t: () => '',
    });

    expect(findRow(rows, 'fileType')?.title).toBe('文件类型');
    expect(findRow(rows, 'disabled')?.title).toBe('是否禁用');
  });

  it('忽略传入的组件名参数并只认闭包中的名称', /** form-create 传入的名称与注册名不一致时仍须命中本组件文案。 */ () => {
    const translate = vi.fn(
      /** 记录被请求的语言键，用于核对使用的名称来源。 */ () => '',
    );

    useUploadFileRule().props('SomeOtherName', { t: translate });

    expect(translate).toHaveBeenCalledWith(
      `components.${PROPS_PREFIX}.autoUpload`,
    );
    expect(translate).not.toHaveBeenCalledWith(
      'components.SomeOtherName.props.autoUpload',
    );
  });
});
