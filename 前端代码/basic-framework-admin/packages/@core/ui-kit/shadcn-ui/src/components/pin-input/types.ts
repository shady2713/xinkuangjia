/** 验证码输入组件的属性契约：集中声明长度、倒计时文案、发送逻辑与重试上限等外部可配项。 */
import type { ClassValue } from '@vben-core/shared/utils';

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
