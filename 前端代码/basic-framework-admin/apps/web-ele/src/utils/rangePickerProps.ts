/**
 * 时间范围选择器默认属性：统一列表搜索区的日期格式、占位符与快捷选项。
 *
 * 供 system、infra 各列表的搜索表单展开使用，绑定值为字符串格式；
 * 只提供静态默认值，取值、校验与后端查询口径由各页面自行处理。
 */
import dayjs from 'dayjs';

import { $t } from '#/locales';

/**
 * 时间段选择器拓展
 * @returns 可展开到 el-date-picker 的默认属性：日期格式、起止占位文案与 7 组快捷时间范围。
 */
export function getRangePickerDefaultProps() {
  return {
    // 显示在输入框中的格式
    format: 'YYYY-MM-DD HH:mm:ss',
    // 绑定值的格式。 不指定则绑定值为 Date 对象
    valueFormat: 'YYYY-MM-DD HH:mm:ss',
    defaultTime: [new Date('1 00:00:00'), new Date('1 23:59:59')],
    // 输入框提示文字
    startPlaceholder: $t('utils.rangePicker.beginTime'),
    endPlaceholder: $t('utils.rangePicker.endTime'),
    // 快捷时间范围
    shortcuts: [
      {
        text: $t('utils.rangePicker.today'),
        /** 今天：当天 00:00 至当天结束时刻。 */
        value: () => {
          return [dayjs().startOf('day'), dayjs().endOf('day')];
        },
      },
      {
        text: $t('utils.rangePicker.yesterday'),
        /** 昨天：昨天 00:00 至昨天结束时刻。 */
        value: () => {
          return [
            dayjs().subtract(1, 'day').startOf('day'),
            dayjs().subtract(1, 'day').endOf('day'),
          ];
        },
      },
      {
        text: $t('utils.rangePicker.last7Days'),
        /** 近 7 天：7 天前的 00:00 至今天结束时刻。 */
        value: () => {
          return [
            dayjs().subtract(7, 'day').startOf('day'),
            dayjs().endOf('day'),
          ];
        },
      },
      {
        text: $t('utils.rangePicker.last30Days'),
        /** 近 30 天：30 天前的 00:00 至今天结束时刻。 */
        value: () => {
          return [
            dayjs().subtract(30, 'day').startOf('day'),
            dayjs().endOf('day'),
          ];
        },
      },
      {
        text: $t('utils.rangePicker.thisWeek'),
        /** 本周起点至今天结束时刻；起点按 dayjs 当前语言的周起始日计算。 */
        value: () => {
          return [dayjs().startOf('week'), dayjs().endOf('day')];
        },
      },
      {
        text: $t('utils.rangePicker.lastWeek'),
        /** 上周起点至今天结束时刻；起点按 dayjs 当前语言的周起始日计算。 */
        value: () => {
          return [
            dayjs().subtract(1, 'week').startOf('day'),
            dayjs().endOf('day'),
          ];
        },
      },
      {
        text: $t('utils.rangePicker.thisMonth'),
        /** 本月 1 日 00:00 至今天结束时刻。 */
        value: () => {
          return [dayjs().startOf('month'), dayjs().endOf('day')];
        },
      },
    ],
  };
}
