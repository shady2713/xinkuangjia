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
 * @author zzf
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
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
        // 创建客户端；枚举与实现分支当前一一对应，解析结果仍统一交给防御校验确认。
        AbstractSmsClient client = switch (channelEnum) {
            case ALIYUN -> new AliyunSmsClient(properties);
            case TENCENT -> new TencentSmsClient(properties);
        };
        return requireClient(client, properties);
    }

    /**
     * 校验渠道解析结果确实对应一个客户端实现，未匹配时记录脱敏摘要并拒绝。
     *
     * <p><b>输入契约：</b>{@code client} 是渠道枚举解析出的客户端，允许为 null —— 表示
     * {@link SmsChannelEnum} 新增（或改名）了渠道常量却没有补上对应实现分支。这是必须在
     * 初始化与注册之前拦下的配置级错误：若放行，未实现的渠道会以空客户端进入按编号注册表，
     * 故障点会推迟到真正发送时才以无关的空指针暴露。</p>
     *
     * <p>拒绝输出只包含渠道编号与编码组成的摘要，绝不包含 apiKey / apiSecret；调用方的
     * 允许类型集合与对外配置项都不因该校验改变。</p>
     *
     * @param client 渠道解析结果，可为 null
     * @param properties 触发解析的渠道配置，仅用于生成脱敏摘要
     * @return 非空的渠道解析结果
     * @throws IllegalArgumentException 解析结果为空时固定抛出，消息仅含脱敏摘要
     */
    AbstractSmsClient requireClient(AbstractSmsClient client, SmsChannelProperties properties) {
        if (client != null) {
            return client;
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
