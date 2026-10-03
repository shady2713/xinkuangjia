/**
 * 应用内使用的第三方模块声明。
 *
 * 这些包上游不提供类型定义；集中在此声明，避免在业务代码里压制类型检查。
 * 只有本应用的 tsconfig 会加载 json-viewer 等包的源码，因此声明必须放在应用侧。
 */

declare module 'vue-json-viewer' {
  import type { Component } from 'vue';

  /**
   * vue-json-viewer 3.x 没有类型定义。
   * 它接受一整套 JSON 查看属性（value、expandDepth、copyable、theme 等），
   * 本应用统一通过 v-bind 透传，因此按不透明组件声明，属性正确性由调用方保证。
   */
  const VueJsonViewer: Component;

  export default VueJsonViewer;
}

declare module 'json-bigint' {
  /** 解析选项：控制超长数字的处理方式。 */
  interface JsonBigintOptions {
    /** 为 true 时把超出安全整数范围的数字按字符串返回，避免精度丢失。 */
    storeAsString?: boolean;
  }

  /** 按固定选项创建的解析器。 */
  interface JsonBigintParser {
    /**
     * 解析 JSON 文本。
     * @param text 待解析的 JSON 文本。
     * @returns 解析结果，具体形状由文本决定。
     */
    parse(text: string): unknown;
  }

  /**
   * 创建按指定选项解析 JSON 的实例。
   * @param options 解析选项。
   * @returns 可重复调用的解析器。
   */
  function jsonBigint(options?: JsonBigintOptions): JsonBigintParser;

  export default jsonBigint;
}
