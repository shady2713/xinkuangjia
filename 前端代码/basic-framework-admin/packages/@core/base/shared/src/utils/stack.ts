/**
 * 标签页访问历史等「最近使用」序列使用的 LIFO 容器。
 * 重复元素先摘旧位置再压栈顶，超出 maxSize 即丢弃最早元素。
 * 不负责持久化与跨页面同步，实例由调用方自行持有。
 */
/**
 * @zh_CN 栈数据结构
 */
export class Stack<T> {
  /**
   * 当前栈内元素个数，随 push/pop/remove/retain 立即变化。
   * @zh_CN 栈内元素数量
   * @returns 栈内元素个数，空栈为 0。
   */
  get size() {
    return this.items.length;
  }
  /**
   * @zh_CN 是否去重
   */
  private readonly dedup: boolean;
  /**
   * @zh_CN 栈内元素
   */
  private items: T[] = [];

  /**
   * @zh_CN 栈的最大容量
   */
  private readonly maxSize?: number;

  /**
   * 创建一个栈实例并确定去重与容量策略。
   * @param dedup - 是否去重：为 true 时重复入栈会先把旧位置的元素摘除再压到栈顶，默认开启。
   * @param maxSize - 栈的最大容量；省略时不限制容量，超出后从栈底方向丢弃最早的元素。
   */
  constructor(dedup = true, maxSize?: number) {
    this.maxSize = maxSize;
    this.dedup = dedup;
  }

  /**
   * 清空栈内元素，去重开关与容量设置保持不变。
   * @zh_CN 清空栈内元素
   */
  clear() {
    this.items.length = 0;
  }

  /**
   * 查看栈顶元素但不移除，用于判断最近一次入栈的内容。
   * @zh_CN 查看栈顶元素
   * @returns 栈顶元素；空栈时为 undefined。
   */
  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }

  /**
   * 弹出并返回栈顶元素，栈因此少一个元素。
   * @zh_CN 出栈
   * @returns 被移除的栈顶元素；空栈时为 undefined。
   */
  pop(): T | undefined {
    return this.items.pop();
  }

  /**
   * 按传入顺序把元素压到栈顶；开启去重时已存在的元素会先被摘除再压回栈顶。
   * 每次压入后若超出 maxSize，会从栈底方向丢弃多余元素。
   * @zh_CN 入栈
   * @param items - 要入栈的元素，可一次传多个。
   */
  push(...items: T[]) {
    items.forEach((item) => {
      // 去重
      if (this.dedup) {
        const index = this.items.indexOf(item);
        if (index !== -1) {
          this.items.splice(index, 1);
        }
      }
      this.items.push(item);
      if (this.maxSize && this.items.length > this.maxSize) {
        this.items.splice(0, this.items.length - this.maxSize);
      }
    });
  }
  /**
   * 移除所有出现在给定列表中的元素，其余元素保持原有顺序。
   * @zh_CN 移除栈内元素
   * @param itemList - 要移除的元素列表，不在栈内的元素会被忽略。
   */
  remove(...itemList: T[]) {
    this.items = this.items.filter((i) => !itemList.includes(i));
  }
  /**
   * 只保留给定列表中的元素，其余全部丢弃，用于把栈裁剪到白名单范围。
   * @zh_CN 保留栈内元素
   * @param itemList - 要保留的元素列表，可包含栈内不存在的元素。
   */
  retain(itemList: T[]) {
    this.items = this.items.filter((i) => itemList.includes(i));
  }

  /**
   * 导出栈内元素的浅拷贝，顺序为栈底到栈顶。
   * @zh_CN 转换为数组
   * @returns 新数组，修改它不会影响栈本身。
   */
  toArray(): T[] {
    return [...this.items];
  }
}

/**
 * 创建一个栈实例。
 * @zh_CN 创建一个栈实例
 * @param dedup - 是否去重，默认开启。
 * @param maxSize - 栈的最大容量，省略时不限制。
 * @returns 新的 Stack 实例。
 */
export const createStack = <T>(dedup = true, maxSize?: number) =>
  new Stack<T>(dedup, maxSize);
