/**
 * node-utils 包出口：汇总构建脚本共用的文件、Git、哈希与包管理能力。
 * 对外暴露 outputJSON、ensureFile、readJSON、getStagedFiles、
 * getPackage、generatorContentHash 等工具，并转发 chalk、consola、
 * execa、rimraf、pkg-types 等三方依赖，让各脚本只依赖本包；
 * 本文件不含实现，也不改变被转发库的行为。
 */
export * from './constants';
export * from './date';
export * from './fs';
export * from './git';
export { getStagedFiles, add as gitAdd } from './git';
export { generatorContentHash } from './hash';
export * from './monorepo';
export { toPosixPath } from './path';
export { prettierFormat } from './prettier';
export * from './spinner';
export type { Package } from '@manypkg/get-packages';
export { default as colors } from 'chalk';
export { consola } from 'consola';
export * from 'execa';

export { default as fs } from 'node:fs/promises';

export { type PackageJson, readPackageJSON } from 'pkg-types';
export { rimraf } from 'rimraf';
