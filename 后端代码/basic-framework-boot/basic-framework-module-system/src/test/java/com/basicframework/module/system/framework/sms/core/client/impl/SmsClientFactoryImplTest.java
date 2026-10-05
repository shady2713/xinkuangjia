package com.basicframework.module.system.framework.sms.core.client.impl;

import com.basicframework.framework.common.core.KeyValue;
import com.basicframework.module.system.framework.sms.core.client.SmsClient;
import com.basicframework.module.system.framework.sms.core.client.dto.SmsReceiveRespDTO;
import com.basicframework.module.system.framework.sms.core.client.dto.SmsSendRespDTO;
import com.basicframework.module.system.framework.sms.core.client.dto.SmsTemplateRespDTO;
import com.basicframework.module.system.framework.sms.core.enums.SmsChannelEnum;
import com.basicframework.module.system.framework.sms.core.property.SmsChannelProperties;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证真实短信客户端工厂的两张注册表、客户端复用与凭据刷新规则。
 *
 * <p>工厂按渠道编码和渠道编号维护两张独立注册表：编码表用于解析供应商回执，
 * 编号表用于实际发送。两者的隔离一旦被破坏，未配置的渠道编号就会拿到构造期
 * 的占位凭据，把短信发到错误的供应商账号上，因此这里逐一锁定注册与复用行为。
 * 客户端初始化与刷新只写日志、不发网络请求，可以在测试环境直接使用真实实现。</p>
 *
 * @author shady2713
 */
class SmsClientFactoryImplTest {

    /** 构造期占位凭据里的账号文本，用于确认拿到的是占位客户端而不是渠道专属客户端。 */
    private static final String PLACEHOLDER_API_KEY = "default default";

    /** 枚举到期望客户端实现的映射；新增枚举而未实现客户端时本用例会失败。 */
    private static final Map<SmsChannelEnum, Class<? extends SmsClient>> EXPECTED_CLIENTS = expectedClients();

    /** 每个受支持的渠道编码都必须能解析出正确实现的客户端，用于解析回执。 */
    @Test
    void everySupportedChannelResolvesToItsClientImplementation() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();

        assertThat(EXPECTED_CLIENTS.keySet())
                .as("枚举新增渠道时必须同步补充期望实现").containsExactlyInAnyOrder(SmsChannelEnum.values());
        for (Map.Entry<SmsChannelEnum, Class<? extends SmsClient>> entry : EXPECTED_CLIENTS.entrySet()) {
            assertThat(factory.getSmsClient(entry.getKey().getCode()))
                    .as("渠道 %s 必须解析到 %s", entry.getKey().getCode(), entry.getValue().getSimpleName())
                    .isInstanceOf(entry.getValue());
        }
    }

    /** 构造期注册的占位客户端没有渠道编号，可据此区分占位客户端与渠道专属客户端。 */
    @Test
    void codeRegisteredClientsCarryNoChannelId() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();

        for (SmsChannelEnum channel : SmsChannelEnum.values()) {
            assertThat(factory.getSmsClient(channel.getCode()).getId())
                    .as("按编码注册的占位客户端不应带渠道编号").isNull();
            assertThat(propertiesOf(factory.getSmsClient(channel.getCode())).getApiKey())
                    .isEqualTo(PLACEHOLDER_API_KEY);
        }
    }

    /** 不在枚举内的渠道编码不得解析出客户端，否则回执会被交给错误的解析器。 */
    @Test
    void unknownChannelCodeResolvesToNoClient() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();

        assertThat(factory.getSmsClient("NOT_A_PROVIDER")).isNull();
    }

    /**
     * 编号注册表初始为空，不能因为编码表里存在占位客户端就按编号取到客户端。
     *
     * <p>若两张表被混用，未配置过的渠道编号会拿到占位凭据并真的发出请求。</p>
     */
    @Test
    void channelIdRegistryIsIndependentFromCodeRegistry() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();

        assertThat(factory.getSmsClient(1L))
                .as("尚未按编号创建过客户端时必须取不到").isNull();
    }

    /** 按编号创建的客户端必须可被再次按编号取到，供实际发送路径复用。 */
    @Test
    void createdClientIsRetrievableByChannelId() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();

        SmsClient created = factory.createOrUpdateSmsClient(aliyunProperties(1L, "key-1", "secret-1"));

        assertThat(created.getId()).isEqualTo(1L);
        assertThat(factory.getSmsClient(1L)).isSameAs(created);
    }

    /**
     * 同一渠道重复创建必须复用同一实例。
     *
     * <p>每次新建客户端会丢失既有状态并重复初始化；复用保证渠道配置只有一份权威来源。</p>
     */
    @Test
    void repeatedCreationReusesTheSameClientInstance() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();
        SmsClient first = factory.createOrUpdateSmsClient(aliyunProperties(1L, "key-1", "secret-1"));

        SmsClient second = factory.createOrUpdateSmsClient(aliyunProperties(1L, "key-1", "secret-1"));

        assertThat(second).isSameAs(first);
        assertThat(factory.getSmsClient(1L)).isSameAs(first);
    }

    /**
     * 凭据变更必须原地刷新到同一实例。
     *
     * <p>密钥轮换后若仍沿用旧凭据，发送会持续被供应商拒绝，而配置看起来已经是新的。</p>
     */
    @Test
    void changedCredentialsAreRefreshedInPlace() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();
        SmsClient client = factory.createOrUpdateSmsClient(aliyunProperties(1L, "key-old", "secret-old"));

        SmsClient refreshed = factory.createOrUpdateSmsClient(aliyunProperties(1L, "key-new", "secret-new"));

        assertThat(refreshed).isSameAs(client);
        assertThat(propertiesOf(client).getApiKey()).isEqualTo("key-new");
        assertThat(propertiesOf(client).getApiSecret()).isEqualTo("secret-new");
    }

    /**
     * 配置未变化时不得替换配置对象，避免每次发送都触发一次无意义的重新初始化。
     *
     * <p>该分支在生产里是热路径，配置等价却替换引用会让刷新判定永远成立。</p>
     */
    @Test
    void identicalConfigurationKeepsTheOriginalPropertiesObject() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();
        SmsChannelProperties original = aliyunProperties(1L, "key-1", "secret-1");
        SmsClient client = factory.createOrUpdateSmsClient(original);

        factory.createOrUpdateSmsClient(aliyunProperties(1L, "key-1", "secret-1"));

        assertThat(propertiesOf(client))
                .as("等价配置不应替换配置对象").isSameAs(original);
    }

    /** 未支持的渠道编码必须在创建时失败，且不得留下半初始化的注册记录。 */
    @Test
    void unknownChannelCodeIsRejectedOnCreate() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();
        SmsChannelProperties properties = new SmsChannelProperties();
        properties.setId(9L);
        properties.setCode("NOT_A_PROVIDER");
        properties.setApiKey("key");
        properties.setApiSecret("secret");

        assertThatThrownBy(() -> factory.createOrUpdateSmsClient(properties))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(factory.getSmsClient(9L)).as("创建失败不得留下注册记录").isNull();
    }

    /**
     * 账号或密钥为空时必须创建失败。
     *
     * <p>渠道表的密钥列允许为空，若放行就会以空凭据向供应商发起请求，
     * 故障表现为难以定位的供应商鉴权失败。</p>
     */
    @Test
    void blankCredentialsAreRejectedOnCreate() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();
        SmsChannelProperties withoutKey = aliyunProperties(11L, "", "secret");
        SmsChannelProperties withoutSecret = aliyunProperties(12L, "key", null);

        assertThatThrownBy(() -> factory.createOrUpdateSmsClient(withoutKey))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> factory.createOrUpdateSmsClient(withoutSecret))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(factory.getSmsClient(11L)).isNull();
        assertThat(factory.getSmsClient(12L)).isNull();
    }

    /**
     * 腾讯云账号必须写成“secretId sdkAppId”两段格式。
     *
     * <p>两段格式是生产为兼容既有账号结构定下的约定，写成单段会在真正发送时才暴露问题。</p>
     */
    @Test
    void tencentApiKeyMustCarrySdkAppId() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();
        SmsChannelProperties wrong = tencentProperties(21L, "only-secret-id", "secret");
        SmsChannelProperties right = tencentProperties(22L, "secret-id 1400000000", "secret");

        assertThatThrownBy(() -> factory.createOrUpdateSmsClient(wrong))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(factory.createOrUpdateSmsClient(right).getId()).isEqualTo(22L);
        assertThat(factory.getSmsClient(21L)).isNull();
    }

    /**
     * 配置未提供时摘要必须给出可读占位文本，不能抛出空指针。
     *
     * <p>抽象基类的构造方法允许配置缺省（按编码注册的占位客户端只用于解析回执），初始化会写配置
     * 摘要日志；摘要若解引用空配置，初始化会在日志语句上失败，故障点与真实原因完全无关。
     * 这里走真实 {@code init()} 入口，并确认正常配置的摘要仍包含渠道编号与编码。</p>
     */
    @Test
    void configurationSummaryToleratesMissingConfiguration() {
        ProbeSmsClient client = new ProbeSmsClient();

        assertThatCode(client::init).doesNotThrowAnyException();

        assertThat(client.summarizeProperties(aliyunProperties(33L, "key-1", "secret-1")))
                .as("正常配置的摘要必须包含渠道编号与编码，便于定位是哪条渠道在刷新")
                .isEqualTo("id(33) code(ALIYUN)");
    }

    /**
     * 不带渠道配置的短信客户端探针，用于观察抽象基类在配置缺省时的初始化行为。
     *
     * <p>基类构造方法不校验配置，真实渠道实现才要求凭据；这里只需复现“配置为空”的基类状态，
     * 因此发送、回执解析与模板查询都不参与本用例。</p>
     */
    static class ProbeSmsClient extends AbstractSmsClient {

        /** 以缺省配置构造，对应只用于解析回执的占位客户端状态。 */
        ProbeSmsClient() {
            super(null);
        }

        /** 本探针不发送短信。 */
        @Override
        public SmsSendRespDTO sendSms(Long logId, String mobile, String apiTemplateId,
                                      List<KeyValue<String, Object>> templateParams) {
            throw new UnsupportedOperationException("探针不发送短信");
        }

        /** 本探针不解析回执。 */
        @Override
        public List<SmsReceiveRespDTO> parseSmsReceiveStatus(String text) {
            throw new UnsupportedOperationException("探针不解析回执");
        }

        /** 本探针不查询模板。 */
        @Override
        public SmsTemplateRespDTO getSmsTemplate(String apiTemplateId) {
            throw new UnsupportedOperationException("探针不查询模板");
        }
    }

    /** 构造阿里云渠道配置，签名与回调地址一并参与配置等价判定。 */
    private static SmsChannelProperties aliyunProperties(Long id, String apiKey, String apiSecret) {
        SmsChannelProperties properties = new SmsChannelProperties();
        properties.setId(id);
        properties.setSignature("测试签名");
        properties.setCode(SmsChannelEnum.ALIYUN.getCode());
        properties.setApiKey(apiKey);
        properties.setApiSecret(apiSecret);
        properties.setCallbackUrl("http://127.0.0.1/callback");
        return properties;
    }

    /** 构造腾讯云渠道配置，账号需符合两段格式约定。 */
    private static SmsChannelProperties tencentProperties(Long id, String apiKey, String apiSecret) {
        SmsChannelProperties properties = new SmsChannelProperties();
        properties.setId(id);
        properties.setSignature("测试签名");
        properties.setCode(SmsChannelEnum.TENCENT.getCode());
        properties.setApiKey(apiKey);
        properties.setApiSecret(apiSecret);
        return properties;
    }

    /**
     * 配置摘要必须同时覆盖「没有配置」与「有配置」两种取值，且只暴露渠道编号与编码。
     *
     * <p><b>白盒直调：</b>该摘要是私有方法，公开路径只会在「枚举新增渠道但开关未补分支」的
     * 防御分支里调用（见 {@code createSmsClient} 尾部的兜底）。生产代码当前的
     * {@link SmsChannelEnum} 只有阿里云与腾讯云两个常量且开关已全部覆盖，因此这条公开路径
     * 在本版本不可达；此处直接校验该方法自身声明的形参域，确认它不会把 apiKey / apiSecret
     * 等凭据写进日志摘要，并在入参为空时给出稳定的 "null" 文本。</p>
     */
    @Test
    void summarizePropertiesNeverLeaksCredentialsAndHandlesNullChannel() {
        SmsClientFactoryImpl factory = new SmsClientFactoryImpl();
        SmsChannelProperties properties = aliyunProperties(0L, "DUMMY-ACCESS-KEY", "DUMMY-ACCESS-SECRET");

        Object summary = ReflectionTestUtils.invokeMethod(factory, "summarizeProperties", properties);

        assertThat(summary).isEqualTo("id(0) code(ALIYUN)");
        assertThat((String) summary)
                .as("配置摘要写入日志，绝不能包含任何凭据")
                .doesNotContain("DUMMY-ACCESS-KEY")
                .doesNotContain("DUMMY-ACCESS-SECRET");
        Object nullSummary = ReflectionTestUtils.invokeMethod(factory, "summarizeProperties",
                (SmsChannelProperties) null);
        assertThat(nullSummary)
                .as("空配置必须给出稳定文本，而不是抛出空指针")
                .isEqualTo("null");
    }

    /**
     * 读取客户端当前生效的配置。
     *
     * <p>生产配置字段是抽象类的受保护状态，没有公开读取入口，
     * 只能通过反射观察，否则无法区分“刷新已生效”与“仍然持有旧配置”。</p>
     */
    private static SmsChannelProperties propertiesOf(SmsClient client) {
        assertThat(client).isInstanceOf(AbstractSmsClient.class);
        return (SmsChannelProperties) ReflectionTestUtils.getField(client, "properties");
    }

    /** 枚举到客户端实现的期望映射，缺少条目时由断言暴露新增枚举。 */
    private static Map<SmsChannelEnum, Class<? extends SmsClient>> expectedClients() {
        Map<SmsChannelEnum, Class<? extends SmsClient>> mapping = new LinkedHashMap<>();
        mapping.put(SmsChannelEnum.ALIYUN, AliyunSmsClient.class);
        mapping.put(SmsChannelEnum.TENCENT, TencentSmsClient.class);
        return mapping;
    }
}
