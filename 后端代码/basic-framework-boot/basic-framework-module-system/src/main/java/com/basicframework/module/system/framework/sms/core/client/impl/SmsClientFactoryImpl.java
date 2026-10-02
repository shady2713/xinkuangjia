package com.basicframework.module.system.framework.sms.core.client.impl;

import com.basicframework.module.system.framework.sms.core.client.SmsClient;
import com.basicframework.module.system.framework.sms.core.client.SmsClientFactory;
import com.basicframework.module.system.framework.sms.core.enums.SmsChannelEnum;
import com.basicframework.module.system.framework.sms.core.property.SmsChannelProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.Assert;
import org.springframework.validation.annotation.Validated;

import java.util.Arrays;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * 短信客户端工厂接口
 *
 * @author 李杰
 */
@Validated
@Slf4j
public class SmsClientFactoryImpl implements SmsClientFactory {

    /**
     * 短信客户端 Map
     * key：渠道编号，使用 {@link SmsChannelProperties#getId()}
     */
    private final ConcurrentMap<Long, AbstractSmsClient> channelIdClients = new ConcurrentHashMap<>();

    /**
     * 短信客户端 Map
     * key：渠道编码，使用 {@link SmsChannelProperties#getCode()} ()}
     *
     * 注意，一些场景下，需要获得某个渠道类型的客户端，所以需要使用它。
     * 例如说，解析短信接收结果，是相对通用的，不需要使用某个渠道编号的 {@link #channelIdClients}
     */
    private final ConcurrentMap<String, AbstractSmsClient> channelCodeClients = new ConcurrentHashMap<>();

    /**
     * 创建 SmsClientFactoryImpl，并初始化所需依赖与配置。
     */
    public SmsClientFactoryImpl() {
        // 初始化 channelCodeClients 集合
        Arrays.stream(SmsChannelEnum.values()).forEach(channel -> {
            // 创建一个空的 SmsChannelProperties 对象
            SmsChannelProperties properties = new SmsChannelProperties();
            properties.setCode(channel.getCode());
            properties.setApiKey("default default");
            properties.setApiSecret("default");
            // 创建 Sms 客户端
            AbstractSmsClient smsClient = createSmsClient(properties);
            channelCodeClients.put(channel.getCode(), smsClient);
        });
    }

    /**
     * 获取短信客户端。
     *
     * @param channelId channelId 编号
     * @return 查询或转换后的结果
     */
    @Override
    public SmsClient getSmsClient(Long channelId) {
        return channelIdClients.get(channelId);
    }

    /**
     * 获取短信客户端。
     *
     * @param channelCode channelCode 参数
     * @return 查询或转换后的结果
     */
    @Override
    public SmsClient getSmsClient(String channelCode) {
        return channelCodeClients.get(channelCode);
    }

    /**
     * 创建或更新短信客户端。
     *
     * @param properties properties 参数
     * @return 操作结果
     */
    @Override
    public SmsClient createOrUpdateSmsClient(SmsChannelProperties properties) {
        AbstractSmsClient client = channelIdClients.get(properties.getId());
        if (client == null) {
            client = this.createSmsClient(properties);
            client.init();
            channelIdClients.put(client.getId(), client);
        } else {
            client.refresh(properties);
        }
        return client;
    }

    /**
     * 创建短信客户端。
     */
    private AbstractSmsClient createSmsClient(SmsChannelProperties properties) {
        SmsChannelEnum channelEnum = SmsChannelEnum.getByCode(properties.getCode());
        Assert.notNull(channelEnum, String.format("渠道类型(%s) 为空", channelEnum));
        // 创建客户端
        switch (channelEnum) {
            case ALIYUN: return new AliyunSmsClient(properties);
            case TENCENT: return new TencentSmsClient(properties);
        }
        // 创建失败，错误日志 + 抛出异常
        String configSummary = summarizeProperties(properties);
        log.error("[createSmsClient][配置摘要({}) 找不到合适的客户端实现]", configSummary);
        throw new IllegalArgumentException(String.format("配置摘要(%s) 找不到合适的客户端实现", configSummary));
    }

    /**
     * 汇总marizeProperties。
     */
    private String summarizeProperties(SmsChannelProperties properties) {
        if (properties == null) {
            return "null";
        }
        return String.format("id(%s) code(%s)", properties.getId(), properties.getCode());
    }

}
