/**
 * 关于页的类型契约：页面属性（名称、标题、描述）与信息条目（标题加组件或文本内容）。
 * 只声明类型，构建元数据的读取与分组展示由同目录 about.vue 负责。
 */
import type { Component } from 'vue';

interface AboutProps {
  description?: string;
  name?: string;
  title?: string;
}

interface DescriptionItem {
  content: Component | string;
  title: string;
}

export type { AboutProps, DescriptionItem };
