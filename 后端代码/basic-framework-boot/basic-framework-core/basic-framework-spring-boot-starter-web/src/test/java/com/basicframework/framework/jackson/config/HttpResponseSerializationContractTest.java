package com.basicframework.framework.jackson.config;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.Module;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 HTTP 响应在真实序列化下的字段契约：分页、时间、标识符、金额、空值与枚举。
 *
 * <p>单个序列化器已有用例，这里覆盖的是**装配后的真实响应文本**：管理端返回
 * {@code CommonResult<PageResult<T>>}，前端依赖其中的 {@code code/msg/data}、{@code total/list}、
 * 毫秒时间戳、超长编号文本化、金额精度与空字段是否出现。任一环节只在部分映射器上生效，
 * 都会让浏览器拿到的字段形态与后端声明不一致，而这些差异无法由 Service 层测试发现。</p>
 *
 * @author DeepSeek
 */
class HttpResponseSerializationContractTest {

    /** Spring MVC 消息转换器同源构造的响应映射器，规则来自生产自动配置。 */
    private ObjectMapper mapper;

    /** 按生产自动配置装配映射器，并关闭时间戳数组形态以对齐 Boot 默认值。 */
    @BeforeEach
    void buildProductionMapper() {
        Jackson2ObjectMapperBuilder builder = Jackson2ObjectMapperBuilder.json();
        new BasicFrameworkJacksonAutoConfiguration().ldtEpochMillisCustomizer().customize(builder);
        Module module = new BasicFrameworkJacksonAutoConfiguration().timestampSupportModuleBean();
        builder.modulesToInstall(module);
        builder.featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper = builder.build();
    }

    /**
     * 分页响应的真实文本必须包含统一响应包装与分页字段。
     *
     * <p>前端按下标读取 {@code data.list} 与 {@code data.total}；字段名或层级改变会让分页
     * 组件静默显示空列表。</p>
     */
    @Test
    void pageResponseKeepsEnvelopeAndPaginationFields() {
        PageResult<RowVO> page = new PageResult<>(List.of(new RowVO(1L, "示例")), 3L);
        CommonResult<PageResult<RowVO>> result = CommonResult.success(page);

        String json = write(result);

        assertThat(json).contains("\"code\":0").contains("\"msg\":\"\"");
        assertThat(json).contains("\"data\":{").contains("\"total\":3").contains("\"list\":[{");
        assertThat(json).contains("\"name\":\"示例\"");
    }

    /** 空分页结果仍必须给出空的 {@code list} 数组，而不是缺字段或 {@code null}。 */
    @Test
    void emptyPageSerializesAsEmptyArray() {
        String json = write(CommonResult.success(PageResult.empty()));

        assertThat(json).contains("\"total\":0").contains("\"list\":[]");
    }

    /**
     * 时间字段按毫秒时间戳输出，带 {@code @JsonFormat} 的字段改用声明格式。
     *
     * <p>两种写法同时存在时，只有按字段注解优先的实现才能让导出与页面看到各自约定的格式。</p>
     */
    @Test
    void timeFieldsFollowEpochMillisOrDefaultFormat() {
        LocalDateTime moment = LocalDateTime.of(2024, 1, 2, 3, 4, 5);
        long expected = moment.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();

        String json = write(CommonResult.success(new TimeVO(moment, moment)));

        assertThat(json).contains("\"createTime\":" + expected);
        assertThat(json).contains("\"formattedTime\":\"2024-01-02 03:04:05\"");
    }

    /**
     * 标识符在安全整数范围内是数字，达到或超出边界必须转为文本。
     *
     * <p>当前口径刻意保守：等于 ±(2^53-1) 已经输出字符串，只有严格位于安全范围内部
     * 的取值才输出 JSON 数字；这一点由 {@code NumberSerializerTest} 锁定，HTTP 契约面
     * 必须与之一致，否则前端会在边界值上静默丢精度。</p>
     */
    @Test
    void identifierKeepsPrecisionBeyondSafeInteger() {
        String withinRange = write(CommonResult.success(new IdVO(9007199254740990L)));
        String boundary = write(CommonResult.success(new IdVO(9007199254740991L)));
        String beyondRange = write(CommonResult.success(new IdVO(9007199254740993L)));

        assertThat(withinRange).contains("\"id\":9007199254740990");
        assertThat(boundary).contains("\"id\":\"9007199254740991\"");
        assertThat(beyondRange).contains("\"id\":\"9007199254740993\"");
    }

    /** 金额必须以十进制数字输出并保留声明的小数位，不能丢精度或改成文本。 */
    @Test
    void moneyKeepsScaleAndStaysNumeric() {
        String json = write(CommonResult.success(new MoneyVO(new BigDecimal("12345.60"))));

        assertThat(json).contains("\"amount\":12345.60");
        assertThat(json).doesNotContain("\"amount\":\"12345.60\"");
    }

    /** 空值字段必须原样出现为 {@code null}，前端据此区分“未设置”和“字段不存在”。 */
    @Test
    void nullFieldIsWrittenAsNull() {
        String json = write(CommonResult.success(new RowVO(1L, null)));

        assertThat(json).contains("\"name\":null");
    }

    /** 枚举按名称输出，前端字典与状态判断依赖稳定的文本取值。 */
    @Test
    void enumIsWrittenByName() {
        String json = write(CommonResult.success(new StatusVO(SampleStatus.ENABLED)));

        assertThat(json).contains("\"status\":\"ENABLED\"");
    }

    /** 错误响应同样使用统一包装，且不携带 {@code data} 内容。 */
    @Test
    void errorResponseKeepsEnvelopeWithoutData() {
        String json = write(CommonResult.error(400, "请求参数不正确"));

        assertThat(json).contains("\"code\":400").contains("\"msg\":\"请求参数不正确\"");
        assertThat(json).contains("\"data\":null");
    }

    /**
     * 用真实映射器序列化并返回 JSON 文本。
     *
     * @param value 待序列化的响应对象
     * @return 与 HTTP 响应体一致的 JSON 文本
     * @throws IllegalStateException 序列化失败时抛出，避免用例静默通过
     */
    private String write(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (Exception failure) {
            throw new IllegalStateException("序列化失败: " + value, failure);
        }
    }

    /** 分页行的最小响应模型，含一个可为空的文本字段。 */
    static class RowVO {

        /** 行标识符。 */
        private final Long id;

        /** 行名称；为 null 时用于核对空值输出形态。 */
        private final String name;

        /**
         * 构造分页行。
         *
         * @param id 行标识符
         * @param name 行名称，允许为 null
         */
        RowVO(Long id, String name) {
            this.id = id;
            this.name = name;
        }

        /**
         * 读取行标识符。
         *
         * @return 行标识符
         */
        public Long getId() {
            return id;
        }

        /**
         * 读取行名称。
         *
         * @return 行名称，可能为 null
         */
        public String getName() {
            return name;
        }
    }

    /** 时间字段响应模型，同时覆盖默认时间戳与字段级格式声明。 */
    static class TimeVO {

        /** 按默认规则输出毫秒时间戳的时间。 */
        private final LocalDateTime createTime;

        /** 带 {@code @JsonFormat} 的同一时间，按声明格式输出文本。 */
        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
        private final LocalDateTime formattedTime;

        /**
         * 构造时间响应。
         *
         * @param createTime 默认格式时间
         * @param formattedTime 声明格式时间
         */
        TimeVO(LocalDateTime createTime, LocalDateTime formattedTime) {
            this.createTime = createTime;
            this.formattedTime = formattedTime;
        }

        /**
         * 读取默认格式时间。
         *
         * @return 默认格式时间
         */
        public LocalDateTime getCreateTime() {
            return createTime;
        }

        /**
         * 读取声明格式时间。
         *
         * @return 声明格式时间
         */
        public LocalDateTime getFormattedTime() {
            return formattedTime;
        }
    }

    /** 标识符响应模型。 */
    static class IdVO {

        /** 待验证精度的编号。 */
        private final Long id;

        /**
         * 构造标识符响应。
         *
         * @param id 编号
         */
        IdVO(Long id) {
            this.id = id;
        }

        /**
         * 读取编号。
         *
         * @return 编号
         */
        public Long getId() {
            return id;
        }
    }

    /** 金额响应模型。 */
    static class MoneyVO {

        /** 待验证精度的金额。 */
        private final BigDecimal amount;

        /**
         * 构造金额响应。
         *
         * @param amount 金额
         */
        MoneyVO(BigDecimal amount) {
            this.amount = amount;
        }

        /**
         * 读取金额。
         *
         * @return 金额
         */
        public BigDecimal getAmount() {
            return amount;
        }
    }

    /** 枚举样本，用于核对枚举输出形态。 */
    enum SampleStatus {

        /** 启用状态。 */
        ENABLED,

        /** 停用状态。 */
        DISABLED
    }

    /** 枚举响应模型。 */
    static class StatusVO {

        /** 待验证输出形态的状态。 */
        private final SampleStatus status;

        /**
         * 构造状态响应。
         *
         * @param status 状态枚举
         */
        StatusVO(SampleStatus status) {
            this.status = status;
        }

        /**
         * 读取状态。
         *
         * @return 状态枚举
         */
        public SampleStatus getStatus() {
            return status;
        }
    }
}
