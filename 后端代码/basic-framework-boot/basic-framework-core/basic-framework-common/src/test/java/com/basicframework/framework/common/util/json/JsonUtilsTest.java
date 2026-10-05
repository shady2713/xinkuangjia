package com.basicframework.framework.common.util.json;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 JSON 工具类的真实序列化、反序列化、类型转换与失败语义。
 *
 * <p>该工具是接口出入参、缓存值、异常日志请求参数与跨模块消息的公共编解码入口：
 * 任一入口的映射器、空值规则或失败方式发生偏移，都会让调用方拿到空对象、丢字段或
 * 在解析失败时静默通过。因此用例断言真实 JSON 文本与解析后的字段值，并对每个入口
 * 分别验证空输入返回与非法输入的实际异常，而不是只验证「调用不报错」。</p>
 *
 * @author DeepSeek
 */
class JsonUtilsTest {

    /** 静态映射器在用例开始前的原始引用，用例结束必须还原，避免影响同 JVM 的其它用例。 */
    private ObjectMapper originalMapper;

    /** 记录静态映射器原值，使 init 造成的全局替换可以被还原。 */
    @BeforeEach
    void rememberObjectMapper() {
        originalMapper = JsonUtils.getObjectMapper();
    }

    /** 还原静态映射器，保证本类用例对全局状态无残留。 */
    @AfterEach
    void restoreObjectMapper() {
        JsonUtils.init(originalMapper);
    }

    /**
     * 工具类未声明私有构造，实例化不得改变静态入口的行为。
     *
     * <p>该类没有实例状态，但构造方法属于真实可调用面；断言实例化后静态入口仍按同一规则
     * 工作，防止未来把共享状态放进实例，导致按实例使用与静态入口读到不同结果。</p>
     */
    @Test
    void instantiationKeepsStaticEntryBehaviour() {
        new JsonUtils();

        assertThat(JsonUtils.toJsonString(new Session(7L, "张三")))
                .contains("\"id\":7")
                .contains("\"name\":\"张三\"");
        assertThat(JsonUtils.isJson("{}")).isTrue();
    }

    /**
     * {@code init} 必须替换全部静态入口实际使用的映射器，而不只是记录一个引用。
     *
     * <p>Spring 启动时会用容器装配的 ObjectMapper 覆盖默认映射器以统一序列化规则；
     * 若只有部分入口读取新映射器，接口与缓存就会用不同规则产出不同 JSON。</p>
     */
    @Test
    void initSwitchesEveryEntryToGivenMapper() {
        ObjectMapper custom = new ObjectMapper();
        JsonUtils.init(custom);

        Session session = new Session(7L, null);
        assertThat(JsonUtils.getObjectMapper()).isSameAs(custom);
        assertThat(JsonUtils.toJsonString(session))
                .as("默认映射器忽略 null 字段，替换后的映射器必须原样输出 null")
                .contains("\"id\":7")
                .contains("\"name\":null");
        assertThat(new String(JsonUtils.toJsonByte(session), StandardCharsets.UTF_8))
                .isEqualTo(JsonUtils.toJsonString(session));
        assertThat(JsonUtils.parseObject("{\"id\":7,\"name\":\"张三\"}", Session.class).getName()).isEqualTo("张三");
    }

    /**
     * 字符串、字节数组与格式化三种序列化入口必须对同一对象产出一致内容。
     *
     * <p>三者被不同调用方使用（日志、HTTP 体、人工排查），内容不一致会让排查依据与实际
     * 传输内容脱节；时间字段还必须按统一的时间戳规则输出。</p>
     */
    @Test
    void serializationEntriesAgreeOnContent() {
        LocalDateTime loginTime = LocalDateTime.of(2024, 1, 2, 3, 4, 5);
        long expectedMillis = loginTime.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        Session session = new Session(7L, "张三");
        session.setLoginTime(loginTime);

        String json = JsonUtils.toJsonString(session);

        assertThat(json)
                .contains("\"id\":7")
                .contains("\"name\":\"张三\"")
                .contains("\"loginTime\":" + expectedMillis);
        assertThat(new String(JsonUtils.toJsonByte(session), StandardCharsets.UTF_8)).isEqualTo(json);
        assertThat(JsonUtils.toJsonPrettyString(session))
                .as("格式化输出必须换行且可与紧凑输出互相还原")
                .containsPattern("\\R")
                .contains("\"name\"");
        assertThat(JsonUtils.parseObject(JsonUtils.toJsonPrettyString(session), Session.class).getId()).isEqualTo(7L);
    }

    /**
     * 序列化失败必须原样抛出底层异常，不能返回半截 JSON 或空字符串。
     *
     * <p>循环引用无法生成完整 JSON，三个序列化入口都必须显式失败：调用方看到失败才能
     * 停止写缓存或写响应，否则会拿到缺字段的内容并当成正常结果。</p>
     */
    @Test
    void serializationEntriesFailOnUnserializableValue() {
        CyclicNode node = new CyclicNode();
        node.setSelf(node);

        assertThatThrownBy(() -> JsonUtils.toJsonString(node)).isInstanceOf(JsonProcessingException.class);
        assertThatThrownBy(() -> JsonUtils.toJsonByte(node)).isInstanceOf(JsonProcessingException.class);
        assertThatThrownBy(() -> JsonUtils.toJsonPrettyString(node)).isInstanceOf(JsonProcessingException.class);
    }

    /**
     * hutool 解析入口：空输入返回 null，合法内容按同名属性还原对象。
     *
     * <p>该入口用于 {@code @JsonTypeInfo(use = Id.CLASS)} 场景下缺少 class 属性的文本，
     * 与 Jackson 入口并存，两条路径的字段还原结果必须一致。</p>
     */
    @Test
    void parseObject2HandlesEmptyAndValidInput() {
        assertThat((Object) JsonUtils.parseObject2(null, Session.class)).isNull();
        assertThat((Object) JsonUtils.parseObject2("", Session.class)).isNull();

        Session session = JsonUtils.parseObject2("{\"id\":7,\"name\":\"张三\"}", Session.class);
        assertThat(session.getId()).isEqualTo(7L);
        assertThat(session.getName()).isEqualTo("张三");
    }

    /**
     * 按类型解析：空输入返回 null，未知字段被忽略，非法 JSON 抛运行时异常并保留原因。
     *
     * <p>未知字段忽略是跨版本契约的一部分：新增字段的旧客户端不应因为多出的字段失败。</p>
     */
    @Test
    void parseObjectByClassHandlesEmptyUnknownAndMalformedInput() {
        assertThat((Object) JsonUtils.parseObject((String) null, Session.class)).isNull();
        assertThat((Object) JsonUtils.parseObject("", Session.class)).isNull();

        Session session = JsonUtils.parseObject("{\"id\":7,\"name\":\"张三\",\"unknown\":\"x\"}", Session.class);
        assertThat(session.getId()).isEqualTo(7L);
        assertThat(session.getName()).isEqualTo("张三");

        assertThatThrownBy(() -> JsonUtils.parseObject("{invalid", Session.class))
                .as("非法 JSON 必须显式失败，不能静默返回 null")
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
    }

    /**
     * 按一级节点解析：空输入返回 null，命中节点返回对象，缺节点与非法 JSON 都显式失败。
     *
     * <p>缺节点时 Jackson 会读到空内容，调用方必须看到失败而不是被当成「字段为空」。</p>
     */
    @Test
    void parseObjectByPathHandlesEmptyMissingAndMalformedInput() {
        assertThat((Object) JsonUtils.parseObject(null, "data", Session.class)).isNull();
        assertThat((Object) JsonUtils.parseObject("", "data", Session.class)).isNull();

        Session session = JsonUtils.parseObject("{\"data\":{\"id\":7,\"name\":\"张三\"}}", "data", Session.class);
        assertThat(session.getName()).isEqualTo("张三");

        assertThatThrownBy(() -> JsonUtils.parseObject("{\"other\":{}}", "data", Session.class))
                .as("节点不存在时读取空内容必须失败，不能返回空对象")
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
        assertThatThrownBy(() -> JsonUtils.parseObject("{invalid", "data", Session.class))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
    }

    /** 按 Type 解析字符串：空输入返回 null，泛型列表可还原元素字段，非法 JSON 显式失败。 */
    @Test
    void parseObjectByStringTypeHandlesEmptyGenericAndMalformedInput() {
        Type listType = new TypeReference<List<Session>>() {
        }.getType();

        Object nullText = JsonUtils.parseObject((String) null, listType);
        Object emptyText = JsonUtils.parseObject("", listType);
        assertThat(nullText).isNull();
        assertThat(emptyText).isNull();

        List<Session> sessions = JsonUtils.parseObject("[{\"id\":1,\"name\":\"甲\"},{\"id\":2,\"name\":\"乙\"}]", listType);
        assertThat(sessions).extracting(Session::getName).containsExactly("甲", "乙");

        assertThatThrownBy(() -> JsonUtils.parseObject("{invalid", listType))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
    }

    /** 按 Type 解析字节数组：空数组返回 null，正常内容还原字段，非法内容显式失败。 */
    @Test
    void parseObjectByBytesTypeHandlesEmptyAndMalformedInput() {
        Type listType = new TypeReference<List<Session>>() {
        }.getType();

        Object nullBytes = JsonUtils.parseObject((byte[]) null, listType);
        Object emptyBytes = JsonUtils.parseObject(new byte[0], listType);
        assertThat(nullBytes).isNull();
        assertThat(emptyBytes).isNull();

        List<Session> sessions = JsonUtils.parseObject("[{\"id\":1,\"name\":\"甲\"}]".getBytes(StandardCharsets.UTF_8), listType);
        assertThat(sessions).extracting(Session::getId).containsExactly(1L);

        assertThatThrownBy(() -> JsonUtils.parseObject("{invalid".getBytes(StandardCharsets.UTF_8), listType))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
    }

    /**
     * 按 Class 解析字节数组：空数组返回 null，正常内容还原字段，非法内容显式失败。
     *
     * <p>字节入口用于缓存与消息体，静默失败会让上游拿到空对象而不是感知数据损坏。</p>
     */
    @Test
    void parseObjectByBytesClassHandlesEmptyAndMalformedInput() {
        assertThat((Object) JsonUtils.parseObject((byte[]) null, Session.class)).isNull();
        assertThat((Object) JsonUtils.parseObject(new byte[0], Session.class)).isNull();

        Session session = JsonUtils.parseObject("{\"id\":7,\"name\":\"张三\"}".getBytes(StandardCharsets.UTF_8), Session.class);
        assertThat(session.getId()).isEqualTo(7L);

        assertThatThrownBy(() -> JsonUtils.parseObject("{invalid".getBytes(StandardCharsets.UTF_8), Session.class))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
    }

    /**
     * 按 TypeReference 解析：命中时还原字段，非法内容抛运行时异常。
     *
     * <p>该入口与其它字符串入口不同，没有空输入短路；空字符串会作为「无内容」被 Jackson 拒绝，
     * 这里锁定这一真实差异，避免调用方误以为空串会返回 null。</p>
     */
    @Test
    void parseObjectByTypeReferenceHandlesValidAndMalformedInput() {
        List<Session> sessions = JsonUtils.parseObject("[{\"id\":1,\"name\":\"甲\"}]", new TypeReference<List<Session>>() {
        });
        assertThat(sessions).extracting(Session::getName).containsExactly("甲");

        assertThatThrownBy(() -> JsonUtils.parseObject("", new TypeReference<List<Session>>() {
        }))
                .as("无内容与非法内容都必须显式失败")
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
        assertThatThrownBy(() -> JsonUtils.parseObject("{invalid", new TypeReference<List<Session>>() {
        }))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
    }

    /** 静默解析：合法内容返回对象，非法内容返回 null 而不是抛出。 */
    @Test
    void parseObjectQuietlyReturnsNullOnMalformedInput() {
        List<Session> sessions = JsonUtils.parseObjectQuietly("[{\"id\":1,\"name\":\"甲\"}]", new TypeReference<List<Session>>() {
        });
        assertThat(sessions).extracting(Session::getId).containsExactly(1L);

        Object malformed = JsonUtils.parseObjectQuietly("{invalid", new TypeReference<List<Session>>() {
        });
        assertThat(malformed).isNull();
    }

    /**
     * 按元素类型解析列表：空输入返回空列表，正常内容还原元素，非法内容显式失败。
     *
     * <p>空输入返回空列表（而不是 null）是调用方依赖的契约，用于直接做遍历与分页展示。</p>
     */
    @Test
    void parseArrayByClassHandlesEmptyAndMalformedInput() {
        assertThat((List<Session>) JsonUtils.parseArray(null, Session.class)).isEmpty();
        assertThat((List<Session>) JsonUtils.parseArray("", Session.class)).isEmpty();

        List<Session> sessions = JsonUtils.parseArray("[{\"id\":1,\"name\":\"甲\"},{\"id\":2,\"name\":\"乙\"}]", Session.class);
        assertThat(sessions).extracting(Session::getId).containsExactly(1L, 2L);

        assertThatThrownBy(() -> JsonUtils.parseArray("{invalid", Session.class))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
    }

    /**
     * 按一级节点解析列表：空输入返回 null，命中节点还原元素，缺节点与非法内容显式失败。
     *
     * <p>该入口返回 null 而 {@link JsonUtils#parseArray(String, Class)} 返回空列表，两者契约
     * 不同，这里同时锁定，避免调用方按同一种空值语义处理。</p>
     */
    @Test
    void parseArrayByPathHandlesEmptyMissingAndMalformedInput() {
        assertThat((Object) JsonUtils.parseArray(null, "list", Session.class)).isNull();
        assertThat((Object) JsonUtils.parseArray("", "list", Session.class)).isNull();

        List<Session> sessions = JsonUtils.parseArray("{\"list\":[{\"id\":1,\"name\":\"甲\"}]}", "list", Session.class);
        assertThat(sessions).extracting(Session::getName).containsExactly("甲");

        assertThatThrownBy(() -> JsonUtils.parseArray("{\"other\":[]}", "list", Session.class))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
        assertThatThrownBy(() -> JsonUtils.parseArray("{invalid", "list", Session.class))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
    }

    /** 解析为 JsonNode 树：合法内容可继续读取字段，非法内容抛运行时异常。 */
    @Test
    void parseTreeByStringHandlesValidAndMalformedInput() {
        JsonNode node = JsonUtils.parseTree("{\"id\":7,\"nested\":{\"name\":\"张三\"}}");

        assertThat(node.path("id").asLong()).isEqualTo(7L);
        assertThat(node.path("nested").path("name").asText()).isEqualTo("张三");

        assertThatThrownBy(() -> JsonUtils.parseTree("{invalid"))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
    }

    /** 解析字节数组为 JsonNode 树：合法内容可继续读取字段，非法内容抛运行时异常。 */
    @Test
    void parseTreeByBytesHandlesValidAndMalformedInput() {
        JsonNode node = JsonUtils.parseTree("{\"id\":7}".getBytes(StandardCharsets.UTF_8));

        assertThat(node.path("id").asInt()).isEqualTo(7);

        assertThatThrownBy(() -> JsonUtils.parseTree("{invalid".getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(RuntimeException.class)
                .hasCauseInstanceOf(IOException.class);
    }

    /** JSON 判定必须区分对象、数组与普通文本，错误放行会让调用方按 JSON 解析普通文本。 */
    @Test
    void isJsonDistinguishesJsonFromPlainText() {
        assertThat(JsonUtils.isJson("{}")).isTrue();
        assertThat(JsonUtils.isJson("[]")).isTrue();
        assertThat(JsonUtils.isJson("{not-json")).isFalse();
        assertThat(JsonUtils.isJson("DUMMY-TEXT")).isFalse();
        assertThat(JsonUtils.isJson("")).isFalse();
    }

    /** JSON 对象判定必须把数组排除在外，避免调用方对数组按对象读取字段。 */
    @Test
    void isJsonObjectExcludesArraysAndPlainText() {
        assertThat(JsonUtils.isJsonObject("{\"id\":7}")).isTrue();
        assertThat(JsonUtils.isJsonObject("[]")).isFalse();
        assertThat(JsonUtils.isJsonObject("DUMMY-TEXT")).isFalse();
    }

    /**
     * 对象转换：null 返回 null，已是目标类型时返回同一实例，Map 按字段名转换。
     *
     * <p>返回同一实例是避免多一次拷贝的既有契约，调用方依赖它对同一对象做后续修改。</p>
     */
    @Test
    void convertObjectByClassHandlesNullIdentityAndMap() {
        assertThat(JsonUtils.convertObject(null, Session.class)).isNull();

        Session source = new Session(7L, "张三");
        assertThat(JsonUtils.convertObject(source, Session.class)).isSameAs(source);

        Session converted = JsonUtils.convertObject(Map.of("id", 7, "name", "张三"), Session.class);
        assertThat(converted.getId()).isEqualTo(7L);
        assertThat(converted.getName()).isEqualTo("张三");
    }

    /**
     * 带泛型的对象转换：null 返回 null，嵌套结构按目标泛型还原元素类型。
     *
     * <p>泛型信息丢失会让调用方拿到 {@code List<LinkedHashMap>} 并在遍历时抛类型转换异常。</p>
     */
    @Test
    void convertObjectByTypeReferenceHandlesNullAndNestedList() {
        assertThat(JsonUtils.convertObject(null, new TypeReference<List<Session>>() {
        })).isNull();

        List<Map<String, Object>> raw = List.of(Map.of("id", 1, "name", "甲"), Map.of("id", 2, "name", "乙"));
        List<Session> sessions = JsonUtils.convertObject(raw, new TypeReference<List<Session>>() {
        });

        assertThat(sessions).extracting(Session::getClass).containsOnly(Session.class);
        assertThat(sessions).extracting(Session::getName).containsExactly("甲", "乙");
    }

    /** 列表转换：null 返回空列表，Map 列表按元素类型转换，保证调用方可以直接遍历。 */
    @Test
    void convertListHandlesNullAndMapElements() {
        assertThat(JsonUtils.convertList(null, Session.class)).isEmpty();

        List<Session> sessions = JsonUtils.convertList(List.of(Map.of("id", 1, "name", "甲")), Session.class);

        assertThat(sessions).extracting(Session::getId).containsExactly(1L);
    }



    /**
     * 自引用夹具，用于验证序列化失败路径必须显式抛出而不是截断输出。
     *
     * @author DeepSeek
     */
    public static class CyclicNode {

        /** 指向自身的引用，形成 Jackson 无法展开的环。 */
        private CyclicNode self;

        /**
         * 获取自引用。
         *
         * @return 自引用
         */
        public CyclicNode getSelf() {
            return self;
        }

        /**
         * 设置自引用。
         *
         * @param self 自引用
         */
        public void setSelf(CyclicNode self) {
            this.self = self;
        }
    }

    /**
     * 会话夹具，用于验证字段映射、空值与列表泛型还原。
     *
     * @author DeepSeek
     */
    public static class Session {

        /** 会话编号。 */
        private Long id;

        /** 会话名称。 */
        private String name;

        /** 登录时间，用于验证时间戳序列化规则。 */
        private LocalDateTime loginTime;

        /**
         * 创建会话。
         *
         * @param id 会话编号
         * @param name 会话名称
         */
        public Session(Long id, String name) {
            this.id = id;
            this.name = name;
        }

        /**
         * 创建默认会话，供 Jackson 反序列化使用。
         */
        public Session() {
        }

        /**
         * 获取会话编号。
         *
         * @return 会话编号
         */
        public Long getId() {
            return id;
        }

        /**
         * 设置会话编号。
         *
         * @param id 会话编号
         */
        public void setId(Long id) {
            this.id = id;
        }

        /**
         * 获取会话名称。
         *
         * @return 会话名称
         */
        public String getName() {
            return name;
        }

        /**
         * 设置会话名称。
         *
         * @param name 会话名称
         */
        public void setName(String name) {
            this.name = name;
        }

        /**
         * 获取登录时间。
         *
         * @return 登录时间
         */
        public LocalDateTime getLoginTime() {
            return loginTime;
        }

        /**
         * 设置登录时间。
         *
         * @param loginTime 登录时间
         */
        public void setLoginTime(LocalDateTime loginTime) {
            this.loginTime = loginTime;
        }
    }

}
