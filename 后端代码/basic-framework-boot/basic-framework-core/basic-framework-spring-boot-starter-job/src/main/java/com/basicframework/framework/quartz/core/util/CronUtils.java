package com.basicframework.framework.quartz.core.util;

import cn.hutool.core.date.DateUtil;
import cn.hutool.core.date.LocalDateTimeUtil;
import org.quartz.CronExpression;

import java.text.ParseException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * Quartz Cron 表达式工具类。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public class CronUtils {

    /**
     * 禁止外部实例化 CronUtils。
     */
    private CronUtils() {
    }

    /**
     * 校验 CRON 表达式是否有效。
     *
     * @param cronExpression CRON 表达式
     * @return 是否有效
     */
    public static boolean isValid(String cronExpression) {
        return CronExpression.isValidExpression(cronExpression);
    }

    /**
     * 基于 CRON 表达式，获得接下来 n 个满足触发条件的执行时间。
     *
     * @param cronExpression CRON 表达式
     * @param n              需要返回的执行时间数量
     * @return 满足触发条件的执行时间列表；如果表达式后续无有效时间，返回数量可能小于 n
     * @throws IllegalArgumentException CRON 表达式解析失败时抛出
     */
    public static List<LocalDateTime> getNextTimes(String cronExpression, int n) {
        // 1. 获得 CronExpression 对象
        CronExpression cron;
        try {
            cron = new CronExpression(cronExpression);
        } catch (ParseException e) {
            // 保留原始 cause：调用方需要从堆栈定位到底哪一段 CRON 表达式不合法。
            throw new IllegalArgumentException(e.getMessage(), e);
        }
        // 2. 从当前开始计算，n 个满足条件的
        Date now = DateUtil.date();
        List<LocalDateTime> nextTimes = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            Date nextTime = cron.getNextValidTimeAfter(now);
            // 2.1 如果 nextTime 为 null，说明没有更多的有效时间，退出循环
            if (nextTime == null) {
                break;
            }
            nextTimes.add(LocalDateTimeUtil.of(nextTime));
            // 2.2 将当前时间切换为本次触发时间，用于计算下一次触发时间
            now = nextTime;
        }
        return nextTimes;
    }

}
