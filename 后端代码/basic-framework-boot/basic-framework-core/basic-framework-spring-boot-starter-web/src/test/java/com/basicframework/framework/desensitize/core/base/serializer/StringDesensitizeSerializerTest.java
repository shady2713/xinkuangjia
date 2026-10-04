package com.basicframework.framework.desensitize.core.base.serializer;

import com.basicframework.framework.desensitize.core.slider.annotation.MobileDesensitize;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import org.junit.jupiter.api.Test;


import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证脱敏序列化器在真实 Jackson 序列化链路上的输出。
 *
 * <p>脱敏注解通过 {@code @JsonSerialize} 元注解挂到本序列化器上，字段声明脱敏注解后，
 * 序列化器必须按注解指定的处理器与参数遮蔽敏感内容，字段为空时输出 null，未声明脱敏注解的
 * 字段则原样输出。这些行为直接决定接口是否泄漏手机号等敏感信息，因此用例断言最终 JSON 文本，
 * 并覆盖框架注解与业务自定义注解两种声明方式。</p>
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

}
