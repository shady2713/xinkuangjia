/** 验证码输入组件的属性契约：集中声明长度、倒计时文案、发送逻辑与重试上限等外部可配项。 */
import type { ClassValue } from '@vben-core/shared/utils';

/**
 * 验证码输入组件的属性契约。
 * codeLength 决定分格数量与输入框宽度；createText 接收剩余秒数并返回按钮文案，
 * 使倒计时提示的措辞留在使用方；handleSendCode 是发送动作的注入点，
 * 组件只调用它并负责其抛出的异常上报；loading、disabled、maxTime 分别控制
 * 按钮加载态、整体禁用与可重试等待的秒数。class 用于外层容器样式。
 */
interface PinInputProps {
  class?: ClassValue;
  /**
   * 验证码长度
   */
  codeLength?: number;
  /**
   * 发送验证码按钮文本
   */
  createText?: (countdown: number) => string;
  /**
   * 是否禁用
   */
  disabled?: boolean;
  /**
   * 自定义验证码发送逻辑
   * @returns
   */
  handleSendCode?: () => Promise<void>;
  /**
   * 发送验证码按钮loading
   */
  loading?: boolean;
  /**
   * 最大重试时间
   */
  maxTime?: number;
}

export type { PinInputProps };
