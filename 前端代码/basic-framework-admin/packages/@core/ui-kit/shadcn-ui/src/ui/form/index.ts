/**
 * 表单出口：暴露 FormItem、FormLabel、FormControl、FormMessage 与
 * FormDescription 五个原子组件，并透出 FORM_ITEM_INJECTION_KEY；
 * 同时把 vee-validate 的 Form、Field、FieldArray 重命名为
 * Form、FormField、FormFieldArray，页面按同一套前缀引入。
 */
export { default as FormControl } from './FormControl.vue';
export { default as FormDescription } from './FormDescription.vue';
export { default as FormItem } from './FormItem.vue';
export { default as FormLabel } from './FormLabel.vue';
export { default as FormMessage } from './FormMessage.vue';
export { FORM_ITEM_INJECTION_KEY } from './injectionKeys';
export {
  Form,
  Field as FormField,
  FieldArray as FormFieldArray,
} from 'vee-validate';
