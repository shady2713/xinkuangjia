package com.basicframework.framework.desensitize.core.base.serializer;

import cn.hutool.core.annotation.AnnotationUtil;
import com.basicframework.framework.desensitize.core.base.annotation.DesensitizeBy;
import com.basicframework.framework.desensitize.core.slider.annotation.MobileDesensitize;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;


import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mockStatic;

/**
 * 验证脱敏序列化器在真实 Jackson 序列化链路上的输出。
 *
 * <p>脱敏注解通过 {@code @JsonSerialize} 元注解挂到本序列化器上，字段声明脱敏注解后，
 * 序列化器必须按注解指定的处理器与参数遮蔽敏感内容，字段为空时输出 null，未声明脱敏注解的
 * 字段则原样输出。这些行为直接决定接口是否泄漏手机号等敏感信息，因此用例断言最终 JSON 文本，
 * 并覆盖框架注解与业务自定义注解两种声明方式。</p>
 *
 * <p>除正常链路外，本类还锁定两条“不脱敏也不能丢数据”的边界：注解组合查询与逐注解判定
 * 不一致时，兜底必须原样输出原文；字段上挂多个注解时，循环必须继续迭代到命中处理器为止。
 * 前者是兜底输出的单元证据，不能替代真实 Jackson 脱敏集成证据。</p>
 *
 * @author shady2713
 */
class StringDesensitizeSerializerTest {

    /** 声明脱敏注解的字段必须按注解参数遮蔽中间部分。 */
    @Test
    void annotatedFieldIsMasked() throws Exception {
        MobileHolder holder = new MobileHolder();
        holder.setMobile("15112341234");

        String json = new ObjectMapper().writeValueAsString(holder);

        assertThat(json).as("保留前 3 位与后 4 位，中间按替换符遮蔽").isEqualTo("{\"mobile\":\"151****1234\"}");
    }

    /** 空白内容必须输出 null，不得把空白当成可展示内容。 */
    @Test
    void blankValueIsWrittenAsNull() throws Exception {
        MobileHolder holder = new MobileHolder();
        holder.setMobile("   ");

        assertThat(new ObjectMapper().writeValueAsString(holder)).isEqualTo("{\"mobile\":null}");
    }

    /**
     * 只挂序列化器、未声明脱敏注解的字段必须原样输出。
     *
     * <p>这是序列化器的默认分支：没有可用的脱敏处理器时不得改写内容，也不得抛错。</p>
     */
    @Test
    void fieldWithoutDesensitizeAnnotationWritesRawValue() throws Exception {
        PlainHolder holder = new PlainHolder();
        holder.setNote("DUMMY-NOTE");

        assertThat(new ObjectMapper().writeValueAsString(holder)).isEqualTo("{\"note\":\"DUMMY-NOTE\"}");
    }

    /**
     * 注解查询出现不一致时，兜底输出必须是原文而不是空值或异常。
     *
     * <p>{@code serialize} 先用 Hutool 的注解组合查询判断“有没有脱敏注解”，再遍历
     * {@link java.lang.reflect.Field#getAnnotations()} 找可用的处理器。两者同源时结论一致；
     * 一旦查询结果不一致（组合查询非空、逐注解判定为 false），循环会自然走完而不会命中任何
     * 处理器，此时必须原样输出字段值——若这条兜底被删掉或误写成 {@code gen.writeNull()}，
     * 未识别的字段会在接口上静默变成 null，前端看到的不是“没脱敏”而是“没有数据”。</p>
     *
     * <p><b>边界替身：</b>只替换依赖边界 {@link AnnotationUtil} 的两个静态查询结果，序列化器、
     * Jackson 序列化链路、字段读取与 {@code JsonGenerator} 写入都是真实执行；被测业务方法本身
     * 没有被整体替换。该用例是兜底输出单元证据，不能替代真实 Jackson 脱敏集成证据。</p>
     *
     * @throws Exception 序列化失败时抛出
     */
    @Test
    void inconsistentAnnotationQueryFallsBackToRawValue() throws Exception {
        PlainHolder holder = new PlainHolder();
        holder.setNote("D9-VALUE");
        ObjectMapper objectMapper = new ObjectMapper();
        try (MockedStatic<AnnotationUtil> mocked = mockStatic(AnnotationUtil.class)) {
            mocked.when(() -> AnnotationUtil.getCombinationAnnotations(any(), eq(DesensitizeBy.class)))
                    .thenReturn(new DesensitizeBy[]{null});
            mocked.when(() -> AnnotationUtil.hasAnnotation(any(), eq(DesensitizeBy.class)))
                    .thenReturn(false);

            String json = objectMapper.writeValueAsString(holder);

            assertThat(json).as("查询不一致时必须原样输出字段值，而不是 null 或抛错")
                    .isEqualTo("{\"note\":\"D9-VALUE\"}");
            mocked.verify(() -> AnnotationUtil.getCombinationAnnotations(any(), eq(DesensitizeBy.class)));
            mocked.verify(() -> AnnotationUtil.hasAnnotation(any(), eq(DesensitizeBy.class)));
        }
    }

    /**
     * 处理器命中前必须先走完注解循环，不得把第一个未命中的注解当成命中。
     *
     * <p>循环条件本身有两条出口：命中处理器后 {@code return}，以及循环自然走完。真实字段上经常
     * 同时挂多个注解，若把循环写成“只看第一个注解”，排在后面的脱敏注解会失效，敏感字段被原样输出。
     * 这里用挂三个注解、脱敏注解排在最后的字段锁定“继续迭代后命中”的路径。</p>
     *
     * @throws Exception 序列化失败时抛出
     */
    @Test
    void annotationLoopContinuesUntilDesensitizeHandlerMatches() throws Exception {
        LateAnnotatedHolder holder = new LateAnnotatedHolder();
        holder.setMobile("15112341234");

        String json = new ObjectMapper().writeValueAsString(holder);

        assertThat(json).as("最后一个注解命中处理器时仍必须完成脱敏").isEqualTo("{\"mobile\":\"151****1234\"}");
    }

    /**
     * 手机号字段夹具，声明框架提供的脱敏注解。
     *
     * @author shady2713
     */
    public static class MobileHolder {

        /** 手机号，声明脱敏注解。 */
        @MobileDesensitize
        private String mobile;

        /**
         * 获取手机号。
         *
         * @return 手机号
         */
        public String getMobile() {
            return mobile;
        }

        /**
         * 设置手机号。
         *
         * @param mobile 手机号
         */
        public void setMobile(String mobile) {
            this.mobile = mobile;
        }
    }

    /**
     * 普通字段夹具，只挂序列化器而不声明脱敏注解。
     *
     * @author shady2713
     */
    public static class PlainHolder {

        /** 普通文本字段。 */
        @JsonSerialize(using = StringDesensitizeSerializer.class)
        private String note;

        /**
         * 获取文本。
         *
         * @return 文本
         */
        public String getNote() {
            return note;
        }

        /**
         * 设置文本。
         *
         * @param note 文本
         */
        public void setNote(String note) {
            this.note = note;
        }
    }

    /**
     * 脱敏注解排在其它注解之后的手机号夹具，用于验证注解循环会继续迭代到命中为止。
     *
     * @author shady2713
     */
    public static class LateAnnotatedHolder {

        /** 手机号，前面先挂两个非脱敏注解，脱敏注解排在最后。 */
        @Deprecated
        @SuppressWarnings("unused")
        @MobileDesensitize
        private String mobile;

        /**
         * 获取手机号。
         *
         * @return 手机号
         */
        public String getMobile() {
            return mobile;
        }

        /**
         * 设置手机号。
         *
         * @param mobile 手机号
         */
        public void setMobile(String mobile) {
            this.mobile = mobile;
        }
    }

}
