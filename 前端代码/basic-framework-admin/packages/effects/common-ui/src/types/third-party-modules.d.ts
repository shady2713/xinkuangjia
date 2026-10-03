/**
 * common-ui 内使用的第三方模块声明。
 *
 * 这些包上游不提供类型定义，集中在包内声明，避免在业务代码里压制类型检查。
 * 声明必须放在本包 src 下：只有这样 `vue-tsc -p packages/effects/common-ui`
 * 才能看到它们；应用侧的同名声明只覆盖应用自己的编译范围。
 */

declare module 'vue-json-viewer' {
  import type { Component } from 'vue';

  /**
   * vue-json-viewer 3.x 没有类型定义。
   * 它接受一整套 JSON 查看属性（value、expandDepth、copyable、theme 等），
   * common-ui 统一通过 v-bind 透传，因此按不透明组件声明，属性正确性由调用方保证。
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
     * @throws 文本不是合法 JSON 时由底层实现抛出，调用方需自行捕获。
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
