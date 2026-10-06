/**
 * 全局复用的变量、组件、配置，各个模块之间共享
 * 通过单例模式实现,单例必须注意不受请求影响，例如用户信息这些需要根据请求获取的。后续如果有ssr需求，也不会影响
 */

interface ComponentsState {
  /**
   * 组件注册表：键是业务方自定义的组件名，值是实际组件。
   * 键名与组件类型都无法在编译期确定，读取方需自行按名称收窄。
   */
  [key: string]: unknown;
}

/** 框架内部可替换的消息提示集合：字段缺省表示对应场景不弹提示。 */
interface MessageState {
  /** 复制偏好设置成功后的提示；未提供时该场景静默成功。 */
  copyPreferencesSuccess?: (title: string, content?: string) => void;
}

/** 全局共享状态的结构：组件注册表与消息提示两部分。 */
export interface IGlobalSharedState {
  components: ComponentsState;
  message: MessageState;
}

/**
 * 全局共享状态的单例实现，只保存与单次请求无关的进程内数据。
 * 组件注册表按名字整体存取，不做持久化也不建立响应式；写入后需调用方自行感知变化。
 */
class GlobalShareState {
  #components: ComponentsState = {};
  #message: MessageState = {};

  /**
   * 定义框架内部各个场景的消息提示
   * @param copyPreferencesSuccess - 复制偏好设置成功的提示函数，省略即表示不弹该提示。
   */
  public defineMessage({ copyPreferencesSuccess }: MessageState) {
    this.#message = {
      copyPreferencesSuccess,
    };
  }

  /**
   * 读取当前组件注册表。
   * @returns 注册表对象本身（非拷贝），调用方就地修改会直接影响全局状态。
   */
  public getComponents(): ComponentsState {
    return this.#components;
  }

  /**
   * 读取当前消息提示集合。
   * @returns 消息提示对象本身（非拷贝），从未定义过时为空对象。
   */
  public getMessage(): MessageState {
    return this.#message;
  }

  /**
   * 整体替换组件注册表。
   * @param value - 新的注册表；直接替换而不与旧值合并，传空对象即清空已注册组件。
   */
  public setComponents(value: ComponentsState) {
    this.#components = value;
  }
}

/** 全局共享状态单例：所有模块共用同一份组件注册表与消息提示。 */
export const globalShareState = new GlobalShareState();
