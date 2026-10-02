package com.basicframework.module.system.framework.sms.core.client.impl;

import com.basicframework.module.system.framework.sms.core.client.SmsClient;
import com.basicframework.module.system.framework.sms.core.property.SmsChannelProperties;
import lombok.extern.slf4j.Slf4j;

/**
 * 短信客户端的抽象类，提供模板方法，减少子类的冗余代码
 *
 * @since 2021/2/1 9:28
 * @author 李杰
 */
@Slf4j
public abstract class AbstractSmsClient implements SmsClient {

    /**
     * 短信渠道配置
     */
    protected volatile SmsChannelProperties properties;

    /**
     * 创建 AbstractSmsClient，并初始化所需依赖与配置。
     *
     * @param properties 配置参数
     */
    public AbstractSmsClient(SmsChannelProperties properties) {
        this.properties = properties;
    }

    /**
     * 初始化
     */
    public final void init() {
        log.debug("[init][配置摘要({}) 初始化完成]", summarizeProperties(properties));
    }

    /**
     * 完成 refresh 对应的业务处理。
     *
     * @param properties 配置参数
     */
    public final void refresh(SmsChannelProperties properties) {
        // 判断是否更新
        if (properties.equals(this.properties)) {
            return;
        }
        log.info("[refresh][配置摘要({}) 发生变化，重新初始化]", summarizeProperties(properties));
        this.properties = properties;
        // 初始化
        this.init();
    }

    /**
     * 获取Id。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public Long getId() {
        return properties.getId();
    }

    /**
     * 完成 summarizeProperties 对应的业务处理。
     *
     * @param properties 配置参数
     * @return 方法处理结果
     */
    protected String summarizeProperties(SmsChannelProperties properties) {
        if (properties == null) {
            return "null";
        }
        return String.format("id(%s) code(%s)", properties.getId(), properties.getCode());
    }

}