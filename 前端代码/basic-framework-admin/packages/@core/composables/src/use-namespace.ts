/**
 * 组件类名（BEM）与 CSS 变量名的命名空间工具。
 * Namespace helper adapted for the current component conventions.
 */
import { DEFAULT_NAMESPACE } from '@vben-core/shared/constants';

const statePrefix = 'is-';

/**
 * 按 BEM 约定拼接类名：块、块后缀、元素与修饰符按 CSS 类名规则连接。
 * @param namespace 命名空间前缀，来自 DEFAULT_NAMESPACE
 * @param block 块名，通常是组件名
 * @param blockSuffix 块后缀，为空时不参与拼接
 * @param element 元素名，为空时不参与拼接
 * @param modifier 修饰符，为空时不参与拼接
 * @returns 拼接后的完整类名
 */
const _bem = (
  namespace: string,
  block: string,
  blockSuffix: string,
  element: string,
  modifier: string,
) => {
  let cls = `${namespace}-${block}`;
  if (blockSuffix) {
    cls += `-${blockSuffix}`;
  }
  if (element) {
    cls += `__${element}`;
  }
  if (modifier) {
    cls += `--${modifier}`;
  }
  return cls;
};

/**
 * 生成 is- 前缀的状态类名；只传名称时按已启用处理，显式传 state 时按开关返回类名或空串。
 * @param name 状态名，不带 is- 前缀
 * @param args 可选的 state 开关，省略时按已启用处理
 * @returns 带 is- 前缀的状态类名；state 为假或名称为空时返回空串
 */
const is: {
  /**
   * 只传状态名时按“已启用”处理。
   * @param name 状态名，不带 is- 前缀
   * @returns 带 is- 前缀的状态类名
   */
  (name: string): string;
  /**
   * 按 state 决定是否输出状态类名。
   * @param name 状态名，不带 is- 前缀
   * @param state 状态开关；为假或状态名为空时返回空串
   * @returns 带 is- 前缀的状态类名或空串
   */
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  (name: string, state: boolean | undefined): string;
} = (name: string, ...args: [] | [boolean | undefined]) => {
  const state = args.length > 0 ? args[0] : true;
  return name && state ? `${statePrefix}${name}` : '';
};

/**
 * 为指定块生成 BEM 类名与 CSS 变量名的工具集合。
 * @param block 块名，通常是组件名
 * @returns 含 b/e/m/be/em/bm/bem、is 状态类名与 cssVar 系列方法的对象
 */
const useNamespace = (block: string) => {
  const namespace = DEFAULT_NAMESPACE;
  /** 生成块类名，可选块后缀。 */
  const b = (blockSuffix = '') => _bem(namespace, block, blockSuffix, '', '');
  /** 生成元素类名；元素名为空时返回空串。 */
  const e = (element?: string) =>
    element ? _bem(namespace, block, '', element, '') : '';
  /** 生成修饰符类名；修饰符为空时返回空串。 */
  const m = (modifier?: string) =>
    modifier ? _bem(namespace, block, '', '', modifier) : '';
  /** 生成“块后缀 + 元素”类名；两者缺一返回空串。 */
  const be = (blockSuffix?: string, element?: string) =>
    blockSuffix && element
      ? _bem(namespace, block, blockSuffix, element, '')
      : '';
  /** 生成“元素 + 修饰符”类名；两者缺一返回空串。 */
  const em = (element?: string, modifier?: string) =>
    element && modifier ? _bem(namespace, block, '', element, modifier) : '';
  /** 生成“块后缀 + 修饰符”类名；两者缺一返回空串。 */
  const bm = (blockSuffix?: string, modifier?: string) =>
    blockSuffix && modifier
      ? _bem(namespace, block, blockSuffix, '', modifier)
      : '';
  /** 生成“块后缀 + 元素 + 修饰符”类名；三者缺一返回空串。 */
  const bem = (blockSuffix?: string, element?: string, modifier?: string) =>
    blockSuffix && element && modifier
      ? _bem(namespace, block, blockSuffix, element, modifier)
      : '';

  // for css var
  // --el-xxx: value;
  /**
   * 生成组件级 CSS 变量对象，变量名为 --<namespace>-<key>。
   * @param object 变量名与变量值的映射
   * @returns 可直接绑定到 style 的变量对象，值为空的键会被丢弃
   */
  const cssVar = (object: Record<string, string>) => {
    const styles: Record<string, string> = {};
    for (const key in object) {
      if (object[key]) {
        styles[`--${namespace}-${key}`] = object[key];
      }
    }
    return styles;
  };
  // with block
  /**
   * 生成块级 CSS 变量对象，变量名为 --<namespace>-<block>-<key>。
   * @param object 变量名与变量值的映射
   * @returns 可直接绑定到 style 的变量对象，值为空的键会被丢弃
   */
  const cssVarBlock = (object: Record<string, string>) => {
    const styles: Record<string, string> = {};
    for (const key in object) {
      if (object[key]) {
        styles[`--${namespace}-${block}-${key}`] = object[key];
      }
    }
    return styles;
  };

  /** 拼接组件级 CSS 变量名 --<namespace>-<name>。 */
  const cssVarName = (name: string) => `--${namespace}-${name}`;
  /** 拼接块级 CSS 变量名 --<namespace>-<block>-<name>。 */
  const cssVarBlockName = (name: string) => `--${namespace}-${block}-${name}`;

  return {
    b,
    be,
    bem,
    bm,
    // css
    cssVar,
    cssVarBlock,
    cssVarBlockName,
    cssVarName,
    e,
    em,
    is,
    m,
    namespace,
  };
};

/** useNamespace 的返回类型：一个块对应的全部类名与 CSS 变量名方法。 */
type UseNamespaceReturn = ReturnType<typeof useNamespace>;

export type { UseNamespaceReturn };
export { useNamespace };
