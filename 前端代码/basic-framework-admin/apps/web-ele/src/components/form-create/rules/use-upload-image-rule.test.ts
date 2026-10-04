/**
 * 单图上传组件设计器规则（components/form-create/rules/use-upload-image-rule）真实行为回归。
 *
 * 表单设计器用它生成"单图上传"组件的注册项：rule() 决定画布上生成的字段名与默认属性，
 * props() 决定右侧属性面板展示哪些配置行以及中文文案。字段名重复会让同一表单的两个
 * 单图控件互相覆盖取值；图片类型默认值、尺寸与圆角写错会让新拖入的控件带上与业务预期
 * 不符的限制；属性面板文案未国际化会整列显示语言键。用例只使用真实规则实现与真实
 * helpers，不替换任何被测实现。
 */
import type {
  FormCreatePropsContext,
  FormCreatePropsRule,
} from '#/components/form-create/typing';

import { describe, expect, it, vi } from 'vitest';

import { useUploadImageRule } from './use-upload-image-rule';

/** 单图上传组件名，与设计器注册项声明的 name 保持一致。 */
const IMAGE_NAME = 'ImageUpload';

/** 属性面板请求的组件前缀，用于拼接 components.<prefix>.<field> 语言键。 */
const PROPS_PREFIX = `${IMAGE_NAME}.props`;

/** 图片类型限制的默认值：与单图上传组件声明的支持范围一致。 */
const DEFAULT_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];

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

describe('单图上传规则生成', /** rule() 的字段名与默认属性决定画布上控件的真实取值。 */ () => {
  it('生成字段名唯一的单图规则', /** 字段名重复会让同一表单的两个单图控件互相覆盖取值。 */ () => {
    const rule = useUploadImageRule().rule();
    const another = useUploadImageRule().rule();

    expect(rule.type).toBe(IMAGE_NAME);
    expect(rule.title).toBe('单图上传');
    expect(rule.info).toBe('');
    expect(rule.$required).toBe(false);
    expect(rule.field).toMatch(/^[\da-f]{32}$/u);
    expect(rule.field).not.toBe(another.field);
  });

  it('注册项透传图标与名称', /** 图标或名称写错会让设计器找不到组件或显示错误图标。 */ () => {
    const registration = useUploadImageRule();

    expect(registration.icon).toBe('icon-image');
    expect(registration.label).toBe('单图上传');
    expect(registration.name).toBe(IMAGE_NAME);
  });
});

describe('单图上传属性面板', /** props() 决定面板展示哪些配置行及其文案，直接面向使用者。 */ () => {
  it('必填行在首位且使用固定的必填字段', /** 必填行位置或字段名变化会让设计器识别不到必填开关。 */ () => {
    const rows = useUploadImageRule().props(IMAGE_NAME, propsContext());

    expect(rows[0]?.field).toBe('formCreate$required');
    expect(rows[0]?.type).toBe('Required');
    expect(rows[0]?.title).toBe('译文:props.required');
  });

  it('暴露拖拽开关与多选图片类型限制', /** 缺少这些行会让使用者无法在设计器里配置上传行为与可选图片格式。 */ () => {
    const rows = useUploadImageRule().props(IMAGE_NAME, propsContext());

    expect(findRow(rows, 'drag')).toMatchObject({
      type: 'switch',
      value: false,
    });
    expect(findRow(rows, 'fileType')).toMatchObject({
      type: 'select',
      value: DEFAULT_FILE_TYPES,
    });
    expect(findRow(rows, 'fileType')?.props).toEqual({ multiple: true });
  });

  it('选项文案与取值一致且覆盖九种图片格式', /** 选项文案与取值不符会让面板显示与提交值不一致。 */ () => {
    const rows = useUploadImageRule().props(IMAGE_NAME, propsContext());
    const options = ruleOptions(findRow(rows, 'fileType'));

    expect(options).toHaveLength(9);
    expect(
      options.every(
        /** 选项文案必须与取值一致，避免面板显示与提交值不符。 */ (item) =>
          item.label === item.value,
      ),
    ).toBe(true);
    expect(
      options.map(
        /** 取出选项值用于核对支持的图片格式。 */ (item) => item.value,
      ),
    ).toEqual([
      'image/apng',
      'image/bmp',
      'image/gif',
      'image/jpeg',
      'image/pjpeg',
      'image/svg+xml',
      'image/tiff',
      'image/webp',
      'image/x-icon',
    ]);
  });

  it('默认图片类型 image/png 在选项中缺失', /** 真实缺陷：默认值用了 image/png 而选项只提供 image/pjpeg，设计器无法表示该默认值。 */ () => {
    const rows = useUploadImageRule().props(IMAGE_NAME, propsContext());
    const optionValues = ruleOptions(findRow(rows, 'fileType')).map(
      /** 取出选项值用于与默认值比对。 */ (item) => item.value,
    );

    // 默认值中的 jpeg/gif 有对应选项，png 没有；断言现状以便修复后必须同步本用例。
    expect(optionValues).toContain('image/jpeg');
    expect(optionValues).toContain('image/gif');
    expect(DEFAULT_FILE_TYPES).toContain('image/png');
    expect(optionValues).not.toContain('image/png');
    expect(optionValues).toContain('image/pjpeg');
  });

  it('大小限制给出可用的默认值与非负下限', /** 默认值缺失会让新控件不带限制，负下限会生成非法配置。 */ () => {
    const rows = useUploadImageRule().props(IMAGE_NAME, propsContext());

    expect(findRow(rows, 'fileSize')).toMatchObject({
      type: 'inputNumber',
      value: 5,
      props: { min: 0 },
    });
  });

  it('组件尺寸与圆角给出带单位的默认值', /** 缺少单位会让样式值无效，控件退化为原始尺寸。 */ () => {
    const rows = useUploadImageRule().props(IMAGE_NAME, propsContext());

    expect(findRow(rows, 'height')).toMatchObject({
      type: 'input',
      value: '150px',
    });
    expect(findRow(rows, 'width')).toMatchObject({
      type: 'input',
      value: '150px',
    });
    expect(findRow(rows, 'borderradius')).toMatchObject({
      type: 'input',
      value: '8px',
    });
  });

  it('删除按钮与按钮文字开关默认开启', /** 默认关闭会让新拖入的控件缺少删除入口与按钮文字。 */ () => {
    const rows = useUploadImageRule().props(IMAGE_NAME, propsContext());

    expect(findRow(rows, 'disabled')).toMatchObject({
      type: 'switch',
      title: `译文:components.${PROPS_PREFIX}.disabled`,
      value: true,
    });
    expect(findRow(rows, 'showBtnText')).toMatchObject({
      type: 'switch',
      title: `译文:components.${PROPS_PREFIX}.showBtnText`,
      value: true,
    });
  });

  it('按组件前缀与字段名请求翻译文案', /** 语言键前缀写错会让属性面板整列显示成键名。 */ () => {
    const translate = vi.fn(
      /** 记录并回显被请求的语言键。 */ (message: string) => `译文:${message}`,
    );

    const rows = useUploadImageRule().props('IgnoredName', { t: translate });

    expect(translate).toHaveBeenCalledWith('props.required');
    expect(translate).toHaveBeenCalledWith(
      `components.${PROPS_PREFIX}.fileType`,
    );
    expect(findRow(rows, 'fileType')?.title).toBe(
      `译文:components.${PROPS_PREFIX}.fileType`,
    );
  });

  it('翻译缺失时保留中文兜底文案', /** 语言包缺键时面板仍要显示可读中文，不能变成空标题。 */ () => {
    const rows = useUploadImageRule().props(IMAGE_NAME, {
      /** 模拟语言包缺键：翻译结果为空串。 */
      t: () => '',
    });

    expect(findRow(rows, 'fileType')?.title).toBe('图片类型限制');
    expect(findRow(rows, 'borderradius')?.title).toBe('组件边框圆角');
    expect(findRow(rows, 'disabled')?.title).toBe('是否显示删除按钮');
  });

  it('忽略传入的组件名参数并只认闭包中的名称', /** form-create 传入的名称与注册名不一致时仍须命中本组件文案。 */ () => {
    const translate = vi.fn(
      /** 记录被请求的语言键，用于核对使用的名称来源。 */ () => '',
    );

    useUploadImageRule().props('SomeOtherName', { t: translate });

    expect(translate).toHaveBeenCalledWith(`components.${PROPS_PREFIX}.height`);
    expect(translate).not.toHaveBeenCalledWith(
      'components.SomeOtherName.props.height',
    );
  });
});
