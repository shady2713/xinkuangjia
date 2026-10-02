package com.basicframework.module.infra.enums.job;

import cn.hutool.core.collection.CollUtil;
import lombok.AllArgsConstructor;
import lombok.Getter;
import org.quartz.impl.jdbcjobstore.Constants;

import java.util.Set;

/**
 * 任务状态的枚举
 * <p>
 * 说明：INIT、NORMAL、STOP 三种状态分别映射定时任务在 Quartz 中的触发器状态集合。
 * </p>
 *
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum JobStatusEnum {

    /**
     * 初始化中
     */
    INIT(0, CollUtil.newHashSet()),
    /**
     * 开启
     */
    NORMAL(1, CollUtil.newHashSet(Constants.STATE_WAITING, Constants.STATE_ACQUIRED, Constants.STATE_BLOCKED)),
    /**
     * 暂停
     */
    STOP(2, CollUtil.newHashSet(Constants.STATE_PAUSED, Constants.STATE_PAUSED_BLOCKED));

    /**
     * 状态
     */
    private final Integer status;
    /**
     * 对应的 Quartz 触发器的状态集合
     */
    private final Set<String> quartzStates;

}
