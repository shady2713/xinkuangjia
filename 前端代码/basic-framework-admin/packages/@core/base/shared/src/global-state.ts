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

interface MessageState {
  copyPreferencesSuccess?: (title: string, content?: string) => void;
}

export interface IGlobalSharedState {
  components: ComponentsState;
  message: MessageState;
}

class GlobalShareState {
  #components: ComponentsState = {};
  #message: MessageState = {};

  /**
   * 定义框架内部各个场景的消息提示
   */
  public defineMessage({ copyPreferencesSuccess }: MessageState) {
    this.#message = {
      copyPreferencesSuccess,
    };
  }

  public getComponents(): ComponentsState {
    return this.#components;
  }

  public getMessage(): MessageState {
    return this.#message;
  }

  public setComponents(value: ComponentsState) {
    this.#components = value;
  }
}

export const globalShareState = new GlobalShareState();
