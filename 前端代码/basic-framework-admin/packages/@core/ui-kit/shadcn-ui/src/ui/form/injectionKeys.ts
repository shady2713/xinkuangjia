/**
 * 表单项注入键：FormItem 挂载时 provide 自己的 id 前缀，
 * FormControl、FormLabel、FormMessage 经 useFormField 取出后拼接元素 id。
 * 该键只服务于 Vue 依赖注入，不承载字段值与校验状态。
 */
import type { InjectionKey } from 'vue';

/**
 * 表单项 id 前缀的注入键：FormItem 用 useId 生成前缀后 provide 出去，
 * 供同一表单项内的控件、标签与消息拼接出互不冲突的 aria 关联 id。
 */
// eslint-disable-next-line symbol-description
export const FORM_ITEM_INJECTION_KEY = Symbol() as InjectionKey<string>;
