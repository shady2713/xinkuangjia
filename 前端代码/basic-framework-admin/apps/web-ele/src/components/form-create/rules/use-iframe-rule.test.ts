/**
 * 网页 iframe 设计器规则（components/form-create/rules/use-iframe-rule）真实行为回归。
 *
 * 表单设计器用它把 iframe 组件注册到左侧组件面板，rule() 决定画布上生成的字段名与默认属性，
 * props() 决定右侧属性面板展示哪些配置行、默认值以及中文文案。字段名重复会让同一表单的
 * 两个 iframe 互相覆盖取值，URL/高度/宽度默认值或 sandbox 安全项写错会让画布上的组件行为
 * 与页面运行时不符，属性面板文案未国际化会显示成语言键。用例只使用真实的 helpers 与
 * localeProps，不替换任何被测实现。
 */
import type {
  FormCreatePropsContext,
  FormCreatePropsRule,
} from '#/components/form-create/typing';

import { describe, expect, it, vi } from 'vitest';

import { useIframeRule } from './use-iframe-rule';

/** iframe 组件名，同时是设计器注册名与属性面板语言键的一段。 */
const IFRAME_NAME = 'IframeComponent';

/**
 * 设计器上下文的翻译函数形状。
 * @param message 组件请求的语言键。
 * @returns 翻译后的文案。
 */
type Translate = (message: string) => string;

/**
 * 构造设计器上下文。
 * @param translate 翻译函数；省略时按前缀回显语言键，便于核对请求的键。
 * @returns 含 t 翻译函数的设计器上下文。
 */
function propsContext(
  translate: Translate = /** 默认按前缀回显语言键。 */ (message) =>
    `译文:${message}`,
): FormCreatePropsContext {
  return { t: translate };
}

/**
 * 按属性名取出面板配置行。
 * @param rows 属性面板返回的配置行数组。
 * @param field 目标控件绑定的属性名。
 * @returns 命中的配置行。
 * @throws Error 属性名不存在时抛出，避免用例静默地什么都不验证。
 */
function rowByField(rows: FormCreatePropsRule[], field: string) {
  const row = rows.find(
    /** 按属性名匹配配置行。 */ (item) => item.field === field,
  );
  if (!row) {
    throw new Error(`属性面板缺少配置行：${field}`);
  }
  return row;
}

describe('iframe 规则生成', /** rule() 的字段名与默认属性决定画布上控件的真实取值。 */ () => {
  it('按组件名生成字段名唯一的规则', /** 字段名重复会让同一表单的两个 iframe 互相覆盖取值。 */ () => {
    const rule = useIframeRule().rule();
    const another = useIframeRule().rule();

    expect(rule.type).toBe(IFRAME_NAME);
    expect(rule.title).toBe('网页 iframe');
    expect(rule.info).toBe('');
    expect(rule.$required).toBe(false);
    // 运行时表单以 model-value 作为绑定名，写成 value 会让组件取不到值。
    expect(rule.modelField).toBe('model-value');
    expect(rule.field).toMatch(/^[\da-f]{32}$/u);
    expect(rule.field).not.toBe(another.field);
  });

  it('透传图标、名称与标签', /** 图标或名称写错会让设计器面板显示错误的组件条目。 */ () => {
    const registration = useIframeRule();

    expect(registration.icon).toBe('icon-link');
    expect(registration.label).toBe('网页 iframe');
    expect(registration.name).toBe(IFRAME_NAME);
  });
});

describe('iframe 属性面板', /** props() 决定面板展示的配置行、默认值与安全项，直接面向使用者。 */ () => {
  it('必填行在前，其余行为 URL、尺寸、加载方式、全屏与 sandbox', /** 缺少安全项或尺寸默认值会让画布上的 iframe 不可用或存在沙箱风险。 */ () => {
    // 语言包缺键时保留 schema 中的中文兜底文案，这里用空翻译核对兜底后的真实展示内容。
    const rows = useIframeRule().props(
      IFRAME_NAME,
      propsContext(/** 模拟语言包缺键：翻译结果为空串。 */ () => ''),
    );

    expect(
      rows.map(
        /** 取出配置行的属性名，用于核对面板顺序。 */ (row) => row.field,
      ),
    ).toEqual([
      'formCreate$required',
      'url',
      'height',
      'width',
      'loading',
      'allowfullscreen',
      'sandbox',
    ]);
    expect(rowByField(rows, 'url')).toMatchObject({
      info: '请输入完整的 HTTP 或 HTTPS 地址',
      title: 'URL 地址',
      type: 'input',
      value: '',
    });
    expect(rowByField(rows, 'height')).toMatchObject({
      title: 'iframe 高度',
      value: '500px',
    });
    expect(rowByField(rows, 'width')).toMatchObject({
      title: 'iframe 宽度',
      value: '100%',
    });
    expect(rowByField(rows, 'loading')).toMatchObject({
      options: [
        { label: '懒加载', value: 'lazy' },
        { label: '立即加载', value: 'eager' },
      ],
      type: 'select',
      value: 'lazy',
    });
    // 全屏默认放行、sandbox 默认留空：默认收紧沙箱会让已有页面无法嵌入。
    expect(rowByField(rows, 'allowfullscreen')).toMatchObject({
      title: '允许全屏',
      type: 'switch',
      value: true,
    });
    expect(rowByField(rows, 'sandbox')).toMatchObject({
      info: '安全沙箱限制，如：allow-scripts allow-same-origin',
      title: 'sandbox 属性',
      value: '',
    });
  });

  it('按组件名与属性名请求翻译文案', /** 语言键前缀写错会让整块属性面板显示成键名。 */ () => {
    const translate = vi.fn(
      /** 记录并回显被请求的语言键。 */ (message: string) => `译文:${message}`,
    );
    const rows = useIframeRule().props('IgnoredName', propsContext(translate));

    expect(rowByField(rows, 'formCreate$required').title).toBe(
      '译文:props.required',
    );
    expect(rowByField(rows, 'sandbox').title).toBe(
      `译文:components.${IFRAME_NAME}.props.sandbox`,
    );
    expect(translate).toHaveBeenCalledWith(
      `components.${IFRAME_NAME}.props.allowfullscreen`,
    );
  });

  it('翻译缺失时保留中文兜底文案', /** 语言包缺键时面板仍要显示可读中文，不能变成空标题。 */ () => {
    const rows = useIframeRule().props(
      IFRAME_NAME,
      propsContext(/** 模拟语言包缺键：翻译结果为空串。 */ () => ''),
    );

    expect(rowByField(rows, 'formCreate$required').title).toBe('是否必填');
    expect(rowByField(rows, 'url').title).toBe('URL 地址');
  });

  it('按闭包中的组件名取配置，不依赖调用方传入的名称', /** 设计器传入的名称与注册名不一致时，必须仍按本规则自己的组件名取值。 */ () => {
    const translate = vi.fn(
      /** 记录并回显被请求的语言键。 */ (message: string) => `译文:${message}`,
    );

    useIframeRule().props('AnotherName', propsContext(translate));

    expect(translate).toHaveBeenCalledWith(
      `components.${IFRAME_NAME}.props.url`,
    );
    expect(translate).not.toHaveBeenCalledWith(
      'components.AnotherName.props.url',
    );
  });
});
