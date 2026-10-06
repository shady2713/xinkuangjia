/**
 * 常量包统一出口：汇总系统、基础设施、字典三类业务枚举与框架级常量，
 * 并转发 @vben-core/shared/constants 中的通用常量。
 * 业务代码统一从 @vben/constants 引入，无需关心各常量的定义位置。
 */
export * from './biz-infra-enum';
export * from './biz-system-enum';
export * from './core';
export * from './dict-enum';

export * from '@vben-core/shared/constants';
