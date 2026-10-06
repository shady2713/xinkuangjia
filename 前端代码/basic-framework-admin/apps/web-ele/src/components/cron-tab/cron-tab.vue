<script lang="ts" setup>
/**
 * Cron 表达式编辑器：输入框直接双向绑定表达式，也可打开生成器按秒、分、
 * 时、日、月、周、年逐项配置，确认后回写拼装好的表达式。
 * 由 infra/job 的定时任务表单以 CronTab 引入；只负责表达式编辑与拼装，
 * 表达式是否合法由后端判定，任务调度语义不在本组件。
 */
import type { PropType } from 'vue';

import type { CronData, CronValue, ShortcutsType } from './types';

import { computed, onMounted, reactive, ref, watch } from 'vue';

import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElTabPane,
  ElTabs,
} from 'element-plus';

import { showWarningMessage } from '#/utils/feedback';

import { CronDataDefault, CronValueDefault } from './types';

defineOptions({ name: 'Crontab' });

const props = defineProps({
  modelValue: {
    type: String,
    default: '* * * * * ?',
  },
  shortcuts: {
    type: Array as PropType<ShortcutsType[]>,
    /** 缺省无预设项，下拉里只保留内置的常用表达式与「自定义」入口 */
    default: () => [],
  },
});

const emit = defineEmits(['update:modelValue']);

const defaultValue = ref('');
const dialogVisible = ref(false);

const cronValue = reactive<CronValue>(CronValueDefault);

const data = reactive<CronData>(CronDataDefault);
/** 把秒字段的选择拼成 CRON 片段：任意用 *，固定区间用 start-end，周期用 start/end，指定时刻用逗号连接。 */
const value_second = computed(() => {
  const v = cronValue.second;
  switch (v.type) {
    case '0': {
      return '*';
    }
    case '1': {
      return `${v.range.start}-${v.range.end}`;
    }
    case '2': {
      return `${v.loop.start}/${v.loop.end}`;
    }
    case '3': {
      return v.appoint.length > 0 ? v.appoint.join(',') : '*';
    }
    default: {
      return '*';
    }
  }
});

/** 把分钟字段的选择拼成 CRON 片段，模式与秒一致；指定时刻为空时退回 *，避免拼出空字段。 */
const value_minute = computed(() => {
  const v = cronValue.minute;
  switch (v.type) {
    case '0': {
      return '*';
    }
    case '1': {
      return `${v.range.start}-${v.range.end}`;
    }
    case '2': {
      return `${v.loop.start}/${v.loop.end}`;
    }
    case '3': {
      return v.appoint.length > 0 ? v.appoint.join(',') : '*';
    }
    default: {
      return '*';
    }
  }
});

/** 把小时字段的选择拼成 CRON 片段，模式与秒一致；未勾选任何小时时按 * 处理。 */
const value_hour = computed(() => {
  const v = cronValue.hour;
  switch (v.type) {
    case '0': {
      return '*';
    }
    case '1': {
      return `${v.range.start}-${v.range.end}`;
    }
    case '2': {
      return `${v.loop.start}/${v.loop.end}`;
    }
    case '3': {
      return v.appoint.length > 0 ? v.appoint.join(',') : '*';
    }
    default: {
      return '*';
    }
  }
});

/**
 * 把日字段的选择拼成 CRON 片段。除四种通用模式外，日还支持 L（月末）与 ?（不指定），
 * 后者由日与周互斥的联动规则置入，此时本片段让位给周字段。
 */
const value_day = computed(() => {
  const v = cronValue.day;
  switch (v.type) {
    case '0': {
      return '*';
    }
    case '1': {
      return `${v.range.start}-${v.range.end}`;
    }
    case '2': {
      return `${v.loop.start}/${v.loop.end}`;
    }
    case '3': {
      return v.appoint.length > 0 ? v.appoint.join(',') : '*';
    }
    case '4': {
      return 'L';
    }
    case '5': {
      return '?';
    }
    default: {
      return '*';
    }
  }
});

/** 把月份字段的选择拼成 CRON 片段，模式与秒一致；月份候选项为 1-12，不含 L 与 ?。 */
const value_month = computed(() => {
  const v = cronValue.month;
  switch (v.type) {
    case '0': {
      return '*';
    }
    case '1': {
      return `${v.range.start}-${v.range.end}`;
    }
    case '2': {
      return `${v.loop.start}/${v.loop.end}`;
    }
    case '3': {
      return v.appoint.length > 0 ? v.appoint.join(',') : '*';
    }
    default: {
      return '*';
    }
  }
});

/**
 * 把周字段的选择拼成 CRON 片段。周的写法与其它单位不同：
 * 周期模式输出「第几个#星期几」且首尾与配置顺序相反，末位模式输出 星期+L，另有 ? 表示不指定。
 */
const value_week = computed(() => {
  const v = cronValue.week;
  switch (v.type) {
    case '0': {
      return '*';
    }
    case '1': {
      return `${v.range.start}-${v.range.end}`;
    }
    case '2': {
      return `${v.loop.end}#${v.loop.start}`;
    }
    case '3': {
      return v.appoint.length > 0 ? v.appoint.join(',') : '*';
    }
    case '4': {
      return `${v.last}L`;
    }
    case '5': {
      return '?';
    }
    default: {
      return '*';
    }
  }
});

/**
 * 把年份字段的选择拼成 CRON 片段。type 为 -1 表示不限定年份，此时返回空串；
 * 提交时会连同前面的空格一起省略该字段，表达式仍是六段式。
 */
const value_year = computed(() => {
  const v = cronValue.year;
  switch (v.type) {
    case '-1': {
      return '';
    }
    case '0': {
      return '*';
    }
    case '1': {
      return `${v.range.start}-${v.range.end}`;
    }
    case '2': {
      return `${v.loop.start}/${v.loop.end}`;
    }
    case '3': {
      return v.appoint.length > 0 ? v.appoint.join(',') : '';
    }
    default: {
      return '';
    }
  }
});

watch(
  () => cronValue.week.type,
  (val: string) => {
    if (val !== '5') {
      cronValue.day.type = '5';
    }
  },
);

watch(
  () => cronValue.day.type,
  (val: string) => {
    if (val !== '5') {
      cronValue.week.type = '5';
    }
  },
);

watch(
  () => props.modelValue,
  () => {
    defaultValue.value = props.modelValue;
  },
);

onMounted(() => {
  defaultValue.value = props.modelValue;
});

const select = ref<string>();

watch(
  () => select.value,
  () => {
    if (select.value === 'custom') {
      open();
    } else {
      defaultValue.value = select.value || '';
      emit('update:modelValue', defaultValue.value);
    }
  },
);

/** 打开生成器：先按当前表达式回填面板，再显示弹窗，保证看到的是已有配置而非初始值。 */
function open() {
  set();
  dialogVisible.value = true;
}

/**
 * 把当前表达式反向解析回面板的 cronValue，供生成器逐项展示与编辑。
 * 段数不足 6 时提示并按默认表达式解析，此时面板内容会与用户原值不一致，需要用户确认后再提交。
 */
function set() {
  defaultValue.value = props.modelValue;
  let arr = (props.modelValue || '* * * * * ?').split(' ');
  // 简单检查
  if (arr.length < 6) {
    showWarningMessage('cron表达式错误，已转换为默认表达式');
    arr = '* * * * * ?'.split(' ');
  }

  // 秒
  if (arr[0] === '*') {
    cronValue.second.type = '0';
  } else if (arr[0]?.includes('-')) {
    cronValue.second.type = '1';
    cronValue.second.range.start = Number(arr[0].split('-')[0]);
    cronValue.second.range.end = Number(arr[0].split('-')[1]);
  } else if (arr[0]?.includes('/')) {
    cronValue.second.type = '2';
    cronValue.second.loop.start = Number(arr[0].split('/')[0]);
    cronValue.second.loop.end = Number(arr[0].split('/')[1]);
  } else {
    cronValue.second.type = '3';
    cronValue.second.appoint = arr[0]?.split(',') || [];
  }

  // 分
  if (arr[1] === '*') {
    cronValue.minute.type = '0';
  } else if (arr[1]?.includes('-')) {
    cronValue.minute.type = '1';
    cronValue.minute.range.start = Number(arr[1].split('-')[0]);
    cronValue.minute.range.end = Number(arr[1].split('-')[1]);
  } else if (arr[1]?.includes('/')) {
    cronValue.minute.type = '2';
    cronValue.minute.loop.start = Number(arr[1].split('/')[0]);
    cronValue.minute.loop.end = Number(arr[1].split('/')[1]);
  } else {
    cronValue.minute.type = '3';
    cronValue.minute.appoint = arr[1]?.split(',') || [];
  }

  // 小时
  if (arr[2] === '*') {
    cronValue.hour.type = '0';
  } else if (arr[2]?.includes('-')) {
    cronValue.hour.type = '1';
    cronValue.hour.range.start = Number(arr[2].split('-')[0]);
    cronValue.hour.range.end = Number(arr[2].split('-')[1]);
  } else if (arr[2]?.includes('/')) {
    cronValue.hour.type = '2';
    cronValue.hour.loop.start = Number(arr[2].split('/')[0]);
    cronValue.hour.loop.end = Number(arr[2].split('/')[1]);
  } else {
    cronValue.hour.type = '3';
    cronValue.hour.appoint = arr[2]?.split(',') || [];
  }

  // 日
  switch (arr[3]) {
    case '*': {
      cronValue.day.type = '0';
      break;
    }
    case '?': {
      cronValue.day.type = '5';
      break;
    }
    case 'L': {
      cronValue.day.type = '4';
      break;
    }
    default: {
      if (arr[3]?.includes('-')) {
        cronValue.day.type = '1';
        cronValue.day.range.start = Number(arr[3].split('-')[0]);
        cronValue.day.range.end = Number(arr[3].split('-')[1]);
      } else if (arr[3]?.includes('/')) {
        cronValue.day.type = '2';
        cronValue.day.loop.start = Number(arr[3].split('/')[0]);
        cronValue.day.loop.end = Number(arr[3].split('/')[1]);
      } else {
        cronValue.day.type = '3';
        cronValue.day.appoint = arr[3]?.split(',') || [];
      }
    }
  }

  // 月
  if (arr[4] === '*') {
    cronValue.month.type = '0';
  } else if (arr[4]?.includes('-')) {
    cronValue.month.type = '1';
    cronValue.month.range.start = Number(arr[4].split('-')[0]);
    cronValue.month.range.end = Number(arr[4].split('-')[1]);
  } else if (arr[4]?.includes('/')) {
    cronValue.month.type = '2';
    cronValue.month.loop.start = Number(arr[4].split('/')[0]);
    cronValue.month.loop.end = Number(arr[4].split('/')[1]);
  } else {
    cronValue.month.type = '3';
    cronValue.month.appoint = arr[4]?.split(',') || [];
  }

  // 周
  if (arr[5] === '*') {
    cronValue.week.type = '0';
  } else if (arr[5] === '?') {
    cronValue.week.type = '5';
  } else if (arr[5]?.includes('-')) {
    cronValue.week.type = '1';
    cronValue.week.range.start = arr[5].split('-')[0] || '';
    cronValue.week.range.end = arr[5].split('-')[1] || '';
  } else if (arr[5]?.includes('#')) {
    cronValue.week.type = '2';
    cronValue.week.loop.start = Number(arr[5].split('#')[1]);
    cronValue.week.loop.end = arr[5].split('#')[0] || '';
  } else if (arr[5]?.includes('L')) {
    cronValue.week.type = '4';
    cronValue.week.last = arr[5].split('L')[0] || '';
  } else {
    cronValue.week.type = '3';
    cronValue.week.appoint = arr[5]?.split(',') || [];
  }

  // 年
  if (!arr[6]) {
    cronValue.year.type = '-1';
  } else if (arr[6] === '*') {
    cronValue.year.type = '0';
  } else if (arr[6]?.includes('-')) {
    cronValue.year.type = '1';
    cronValue.year.range.start = Number(arr[6].split('-')[0]);
    cronValue.year.range.end = Number(arr[6].split('-')[1]);
  } else if (arr[6]?.includes('/')) {
    cronValue.year.type = '2';
    cronValue.year.loop.start = Number(arr[6].split('/')[1]);
    cronValue.year.loop.end = Number(arr[6].split('/')[0]);
  } else {
    cronValue.year.type = '3';
    cronValue.year.appoint = arr[6]?.split(',') || [];
  }
}

/** 确认生成器配置：拼出完整表达式、同步给外部绑定并关闭弹窗。 */
function submit() {
  const year = value_year.value ? ` ${value_year.value}` : '';
  defaultValue.value = `${value_second.value} ${value_minute.value} ${
    value_hour.value
  } ${value_day.value} ${value_month.value} ${value_week.value}${year}`;
  emit('update:modelValue', defaultValue.value);
  dialogVisible.value = false;
}

/** 输入框内容变化时立即把新值抛给外部，表达式是否合法交由后端判定，组件不拦截。 */
function inputChange() {
  emit('update:modelValue', defaultValue.value);
}
</script>
<template>
  <ElInput
    v-model="defaultValue"
    class="input-with-select"
    v-bind="$attrs"
    @input="inputChange"
  >
    <template #append>
      <ElSelect v-model="select" placeholder="生成器" style="width: 115px">
        <ElOption label="每分钟" value="0 * * * * ?" />
        <ElOption label="每小时" value="0 0 * * * ?" />
        <ElOption label="每天零点" value="0 0 0 * * ?" />
        <ElOption label="每月一号零点" value="0 0 0 1 * ?" />
        <ElOption label="每月最后一天零点" value="0 0 0 L * ?" />
        <ElOption label="每周星期日零点" value="0 0 0 ? * 1" />
        <ElOption
          v-for="(item, index) in shortcuts"
          :key="index"
          :label="item.text"
          :value="item.value"
        />
        <ElOption label="自定义" value="custom" />
      </ElSelect>
    </template>
  </ElInput>

  <ElDialog
    v-model="dialogVisible"
    :width="580"
    append-to-body
    destroy-on-close
    title="cron规则生成器"
  >
    <div class="sc-cron">
      <ElTabs>
        <ElTabPane>
          <template #label>
            <div class="sc-cron-num">
              <h2>秒</h2>
              <h4>{{ value_second }}</h4>
            </div>
          </template>
          <ElForm>
            <ElFormItem label="类型">
              <ElRadioGroup v-model="cronValue.second.type">
                <ElRadioButton value="0">任意值</ElRadioButton>
                <ElRadioButton value="1">范围</ElRadioButton>
                <ElRadioButton value="2">间隔</ElRadioButton>
                <ElRadioButton value="3">指定</ElRadioButton>
              </ElRadioGroup>
            </ElFormItem>
            <ElFormItem v-if="cronValue.second.type === '1'" label="范围">
              <ElInputNumber
                v-model="cronValue.second.range.start"
                :max="59"
                :min="0"
                controls-position="right"
              />
              <span style="padding: 0 15px">-</span>
              <ElInputNumber
                v-model="cronValue.second.range.end"
                :max="59"
                :min="0"
                controls-position="right"
              />
            </ElFormItem>
            <ElFormItem v-if="cronValue.second.type === '2'" label="间隔">
              <ElInputNumber
                v-model="cronValue.second.loop.start"
                :max="59"
                :min="0"
                controls-position="right"
              />
              秒开始，每
              <ElInputNumber
                v-model="cronValue.second.loop.end"
                :max="59"
                :min="0"
                controls-position="right"
              />
              秒执行一次
            </ElFormItem>
            <ElFormItem v-if="cronValue.second.type === '3'" label="指定">
              <ElSelect
                v-model="cronValue.second.appoint"
                multiple
                style="width: 100%"
              >
                <ElOption
                  v-for="(item, index) in data.second"
                  :key="index"
                  :label="item"
                  :value="item"
                />
              </ElSelect>
            </ElFormItem>
          </ElForm>
        </ElTabPane>
        <ElTabPane>
          <template #label>
            <div class="sc-cron-num">
              <h2>分钟</h2>
              <h4>{{ value_minute }}</h4>
            </div>
          </template>
          <ElForm>
            <ElFormItem label="类型">
              <ElRadioGroup v-model="cronValue.minute.type">
                <ElRadioButton value="0">任意值</ElRadioButton>
                <ElRadioButton value="1">范围</ElRadioButton>
                <ElRadioButton value="2">间隔</ElRadioButton>
                <ElRadioButton value="3">指定</ElRadioButton>
              </ElRadioGroup>
            </ElFormItem>
            <ElFormItem v-if="cronValue.minute.type === '1'" label="范围">
              <ElInputNumber
                v-model="cronValue.minute.range.start"
                :max="59"
                :min="0"
                controls-position="right"
              />
              <span style="padding: 0 15px">-</span>
              <ElInputNumber
                v-model="cronValue.minute.range.end"
                :max="59"
                :min="0"
                controls-position="right"
              />
            </ElFormItem>
            <ElFormItem v-if="cronValue.minute.type === '2'" label="间隔">
              <ElInputNumber
                v-model="cronValue.minute.loop.start"
                :max="59"
                :min="0"
                controls-position="right"
              />
              分钟开始，每
              <ElInputNumber
                v-model="cronValue.minute.loop.end"
                :max="59"
                :min="0"
                controls-position="right"
              />
              分钟执行一次
            </ElFormItem>
            <ElFormItem v-if="cronValue.minute.type === '3'" label="指定">
              <ElSelect
                v-model="cronValue.minute.appoint"
                multiple
                style="width: 100%"
              >
                <ElOption
                  v-for="(item, index) in data.minute"
                  :key="index"
                  :label="item"
                  :value="item"
                />
              </ElSelect>
            </ElFormItem>
          </ElForm>
        </ElTabPane>
        <ElTabPane>
          <template #label>
            <div class="sc-cron-num">
              <h2>小时</h2>
              <h4>{{ value_hour }}</h4>
            </div>
          </template>
          <ElForm>
            <ElFormItem label="类型">
              <ElRadioGroup v-model="cronValue.hour.type">
                <ElRadioButton value="0">任意值</ElRadioButton>
                <ElRadioButton value="1">范围</ElRadioButton>
                <ElRadioButton value="2">间隔</ElRadioButton>
                <ElRadioButton value="3">指定</ElRadioButton>
              </ElRadioGroup>
            </ElFormItem>
            <ElFormItem v-if="cronValue.hour.type === '1'" label="范围">
              <ElInputNumber
                v-model="cronValue.hour.range.start"
                :max="23"
                :min="0"
                controls-position="right"
              />
              <span style="padding: 0 15px">-</span>
              <ElInputNumber
                v-model="cronValue.hour.range.end"
                :max="23"
                :min="0"
                controls-position="right"
              />
            </ElFormItem>
            <ElFormItem v-if="cronValue.hour.type === '2'" label="间隔">
              <ElInputNumber
                v-model="cronValue.hour.loop.start"
                :max="23"
                :min="0"
                controls-position="right"
              />
              小时开始，每
              <ElInputNumber
                v-model="cronValue.hour.loop.end"
                :max="23"
                :min="0"
                controls-position="right"
              />
              小时执行一次
            </ElFormItem>
            <ElFormItem v-if="cronValue.hour.type === '3'" label="指定">
              <ElSelect
                v-model="cronValue.hour.appoint"
                multiple
                style="width: 100%"
              >
                <ElOption
                  v-for="(item, index) in data.hour"
                  :key="index"
                  :label="item"
                  :value="item"
                />
              </ElSelect>
            </ElFormItem>
          </ElForm>
        </ElTabPane>
        <ElTabPane>
          <template #label>
            <div class="sc-cron-num">
              <h2>日</h2>
              <h4>{{ value_day }}</h4>
            </div>
          </template>
          <ElForm>
            <ElFormItem label="类型">
              <ElRadioGroup v-model="cronValue.day.type">
                <ElRadioButton value="0">任意值</ElRadioButton>
                <ElRadioButton value="1">范围</ElRadioButton>
                <ElRadioButton value="2">间隔</ElRadioButton>
                <ElRadioButton value="3">指定</ElRadioButton>
                <ElRadioButton value="4">本月最后一天</ElRadioButton>
                <ElRadioButton value="5">不指定</ElRadioButton>
              </ElRadioGroup>
            </ElFormItem>
            <ElFormItem v-if="cronValue.day.type === '1'" label="范围">
              <ElInputNumber
                v-model="cronValue.day.range.start"
                :max="31"
                :min="1"
                controls-position="right"
              />
              <span style="padding: 0 15px">-</span>
              <ElInputNumber
                v-model="cronValue.day.range.end"
                :max="31"
                :min="1"
                controls-position="right"
              />
            </ElFormItem>
            <ElFormItem v-if="cronValue.day.type === '2'" label="间隔">
              <ElInputNumber
                v-model="cronValue.day.loop.start"
                :max="31"
                :min="1"
                controls-position="right"
              />
              号开始，每
              <ElInputNumber
                v-model="cronValue.day.loop.end"
                :max="31"
                :min="1"
                controls-position="right"
              />
              天执行一次
            </ElFormItem>
            <ElFormItem v-if="cronValue.day.type === '3'" label="指定">
              <ElSelect
                v-model="cronValue.day.appoint"
                multiple
                style="width: 100%"
              >
                <ElOption
                  v-for="(item, index) in data.day"
                  :key="index"
                  :label="item"
                  :value="item"
                />
              </ElSelect>
            </ElFormItem>
          </ElForm>
        </ElTabPane>
        <ElTabPane>
          <template #label>
            <div class="sc-cron-num">
              <h2>月</h2>
              <h4>{{ value_month }}</h4>
            </div>
          </template>
          <ElForm>
            <ElFormItem label="类型">
              <ElRadioGroup v-model="cronValue.month.type">
                <ElRadioButton value="0">任意值</ElRadioButton>
                <ElRadioButton value="1">范围</ElRadioButton>
                <ElRadioButton value="2">间隔</ElRadioButton>
                <ElRadioButton value="3">指定</ElRadioButton>
              </ElRadioGroup>
            </ElFormItem>
            <ElFormItem v-if="cronValue.month.type === '1'" label="范围">
              <ElInputNumber
                v-model="cronValue.month.range.start"
                :max="12"
                :min="1"
                controls-position="right"
              />
              <span style="padding: 0 15px">-</span>
              <ElInputNumber
                v-model="cronValue.month.range.end"
                :max="12"
                :min="1"
                controls-position="right"
              />
            </ElFormItem>
            <ElFormItem v-if="cronValue.month.type === '2'" label="间隔">
              <ElInputNumber
                v-model="cronValue.month.loop.start"
                :max="12"
                :min="1"
                controls-position="right"
              />
              月开始，每
              <ElInputNumber
                v-model="cronValue.month.loop.end"
                :max="12"
                :min="1"
                controls-position="right"
              />
              月执行一次
            </ElFormItem>
            <ElFormItem v-if="cronValue.month.type === '3'" label="指定">
              <ElSelect
                v-model="cronValue.month.appoint"
                multiple
                style="width: 100%"
              >
                <ElOption
                  v-for="(item, index) in data.month"
                  :key="index"
                  :label="item"
                  :value="item"
                />
              </ElSelect>
            </ElFormItem>
          </ElForm>
        </ElTabPane>
        <ElTabPane>
          <template #label>
            <div class="sc-cron-num">
              <h2>周</h2>
              <h4>{{ value_week }}</h4>
            </div>
          </template>
          <ElForm>
            <ElForm>
              <ElFormItem label="类型">
                <ElRadioGroup v-model="cronValue.week.type">
                  <ElRadioButton value="0">任意值</ElRadioButton>
                  <ElRadioButton value="1">范围</ElRadioButton>
                  <ElRadioButton value="2">间隔</ElRadioButton>
                  <ElRadioButton value="3">指定</ElRadioButton>
                  <ElRadioButton value="4">本月最后一周</ElRadioButton>
                  <ElRadioButton value="5">不指定</ElRadioButton>
                </ElRadioGroup>
              </ElFormItem>
              <ElFormItem v-if="cronValue.week.type === '1'" label="范围">
                <ElSelect v-model="cronValue.week.range.start">
                  <ElOption
                    v-for="(item, index) in data.week"
                    :key="index"
                    :label="item.label"
                    :value="item.value"
                  />
                </ElSelect>
                <span style="padding: 0 15px">-</span>
                <ElSelect v-model="cronValue.week.range.end">
                  <ElOption
                    v-for="(item, index) in data.week"
                    :key="index"
                    :label="item.label"
                    :value="item.value"
                  />
                </ElSelect>
              </ElFormItem>
              <ElFormItem v-if="cronValue.week.type === '2'" label="间隔">
                第
                <ElInputNumber
                  v-model="cronValue.week.loop.start"
                  :max="4"
                  :min="1"
                  controls-position="right"
                />
                周的星期
                <ElSelect v-model="cronValue.week.loop.end">
                  <ElOption
                    v-for="(item, index) in data.week"
                    :key="index"
                    :label="item.label"
                    :value="item.value"
                  />
                </ElSelect>
                执行一次
              </ElFormItem>
              <ElFormItem v-if="cronValue.week.type === '3'" label="指定">
                <ElSelect
                  v-model="cronValue.week.appoint"
                  multiple
                  style="width: 100%"
                >
                  <ElOption
                    v-for="(item, index) in data.week"
                    :key="index"
                    :label="item.label"
                    :value="item.value"
                  />
                </ElSelect>
              </ElFormItem>
              <ElFormItem v-if="cronValue.week.type === '4'" label="最后一周">
                <ElSelect v-model="cronValue.week.last">
                  <ElOption
                    v-for="(item, index) in data.week"
                    :key="index"
                    :label="item.label"
                    :value="item.value"
                  />
                </ElSelect>
              </ElFormItem>
            </ElForm>
          </ElForm>
        </ElTabPane>
        <ElTabPane>
          <template #label>
            <div class="sc-cron-num">
              <h2>年</h2>
              <h4>{{ value_year }}</h4>
            </div>
          </template>
          <ElForm>
            <ElFormItem label="类型">
              <ElRadioGroup v-model="cronValue.year.type">
                <ElRadioButton value="-1">忽略</ElRadioButton>
                <ElRadioButton value="0">任意值</ElRadioButton>
                <ElRadioButton value="1">范围</ElRadioButton>
                <ElRadioButton value="2">间隔</ElRadioButton>
                <ElRadioButton value="3">指定</ElRadioButton>
              </ElRadioGroup>
            </ElFormItem>
            <ElFormItem v-if="cronValue.year.type === '1'" label="范围">
              <ElInputNumber
                v-model="cronValue.year.range.start"
                controls-position="right"
              />
              <span style="padding: 0 15px">-</span>
              <ElInputNumber
                v-model="cronValue.year.range.end"
                controls-position="right"
              />
            </ElFormItem>
            <ElFormItem v-if="cronValue.year.type === '2'" label="间隔">
              <ElInputNumber
                v-model="cronValue.year.loop.start"
                controls-position="right"
              />
              年开始，每
              <ElInputNumber
                v-model="cronValue.year.loop.end"
                :min="1"
                controls-position="right"
              />
              年执行一次
            </ElFormItem>
            <ElFormItem v-if="cronValue.year.type === '3'" label="指定">
              <ElSelect
                v-model="cronValue.year.appoint"
                multiple
                style="width: 100%"
              >
                <ElOption
                  v-for="(item, index) in data.year"
                  :key="index"
                  :label="item"
                  :value="item"
                />
              </ElSelect>
            </ElFormItem>
          </ElForm>
        </ElTabPane>
      </ElTabs>
    </div>

    <template #footer>
      <ElButton @click="dialogVisible = false">取 消</ElButton>
      <ElButton type="primary" @click="submit()">确 认</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.sc-cron:deep(.el-tabs__item) {
  height: auto;
  padding: 0 7px;
  line-height: 1;
  vertical-align: bottom;
}

.sc-cron-num {
  width: 100%;
  margin-bottom: 15px;
  text-align: center;
}

.sc-cron-num h2 {
  margin-bottom: 15px;
  font-size: 12px;
  font-weight: normal;
}

.sc-cron-num h4 {
  display: block;
  width: 100%;
  height: 32px;
  padding: 0 15px;
  font-size: 12px;
  line-height: 30px;
  background: var(--el-color-primary-light-9);
  border-radius: 4px;
}

.sc-cron:deep(.el-tabs__item.is-active) .sc-cron-num h4 {
  color: #fff;
  background: var(--el-color-primary);
}

[data-theme='dark'] .sc-cron-num h4 {
  background: var(--el-color-white);
}

.input-with-select .el-input-group__prepend {
  background-color: var(--el-fill-color-blank);
}
</style>
