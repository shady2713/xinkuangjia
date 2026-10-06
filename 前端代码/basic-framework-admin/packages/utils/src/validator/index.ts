/**
 * 校验模块的聚合出口：转发 regex 中的手机号、身份证、邮箱和密码正则常量，
 * 以及基于这些正则的 isMobile 判断函数。
 *
 * 表单提示文案与字段规则组装由 apps/web-ele 的 adapter 层负责，不在此定义。
 */
export * from './regex';
export * from './validator';
