package com.basicframework.framework.dict.validation;

import com.basicframework.framework.common.biz.system.dict.DictDataCommonApi;
import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import jakarta.validation.ClockProvider;
import jakarta.validation.ConstraintValidatorContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证单值与集合两种字典范围校验器的真实契约。
 *
 * <p>字典范围是业务枚举落库前的最后一道防线：取值范围来自字典表而不是硬编码，
 * 因此校验结果依赖 {@link DictFrameworkUtils} 加载到的字典数据。这里锁定四条真实约定：
 * 空值与空集合放行（是否必填由 {@code @NotNull} 负责）；字典值按字符串忽略大小写比较，
 * 字母型字典值不因大小写被误拒；越界时禁用默认提示并把 {@code {value}} 替换成实际字典值；
 * 字典类型未登记任何值时范围为空，任何非空取值都被拒。</p>
 *
 * <p><b>测试替身说明</b>：本模块的运行期类路径只有 {@code jakarta.validation-api}，
 * 没有 Bean Validation 提供方（也不能为补测改动 POM），因此校验上下文由本用例的
 * {@link RecordingContext} 忠实记录容器调用：默认提示模板、是否禁用默认提示、
 * 自定义提示内容与是否真正添加违规。校验器与容器之间的契约正是这些调用，
 * 断言对象因此仍然是真实可观察行为，而不是对被测实现的镜像。</p>
 *
 * @author shady2713
 */
class InDictValidatorsTest {

    /** 被测单值校验器，每例重新初始化，避免字典类型在用例间泄漏。 */
    private final InDictValidator singleValueValidator = new InDictValidator();

    /** 被测集合校验器，每例重新初始化，避免字典类型在用例间泄漏。 */
    private final InDictCollectionValidator collectionValidator = new InDictCollectionValidator();

    /** 注入可控字典接口并清空缓存，避免上一例的缓存掩盖本例如实加载行为。 */
    @BeforeEach
    void setUp() {
        DictFrameworkUtils.init(dictDataApi());
        DictFrameworkUtils.clearCache();
    }

    /** 清理字典缓存，避免静态缓存把字典数据带出本用例。 */
    @AfterEach
    void tearDown() {
        DictFrameworkUtils.clearCache();
    }

    /** 单值校验：空值放行，范围内取值放行，越界取值禁用默认提示并给出替换后的字典值提示。 */
    @Test
    void singleValueValidatorAllowsNullAndRejectsValueOutsideDict() throws Exception {
        singleValueValidator.initialize(annotationOf(SexValueHolder.class, "value"));

        RecordingContext passing = new RecordingContext(DEFAULT_TEMPLATE);
        assertThat(singleValueValidator.isValid(null, passing)).as("空值交由必填注解处理").isTrue();
        assertThat(singleValueValidator.isValid("1", passing)).isTrue();
        assertThat(singleValueValidator.isValid("2", passing)).isTrue();
        assertThat(passing.violationTemplate).as("通过时不得构造任何违规提示").isNull();
        assertThat(passing.constraintViolationAdded).isFalse();

        RecordingContext failing = new RecordingContext(DEFAULT_TEMPLATE);
        assertThat(singleValueValidator.isValid("3", failing)).isFalse();
        assertThat(failing.defaultViolationDisabled).as("必须禁用默认提示，避免回显未替换的模板").isTrue();
        assertThat(failing.violationTemplate).as("提示必须替换为真实字典值，供前端展示可选范围")
                .isEqualTo("必须在指定范围 1,2");
        assertThat(failing.constraintViolationAdded).as("构造出的提示必须真正加入违规").isTrue();
    }

    /** 字母型字典值忽略大小写比较，避免前端传入大写时被误判为越界。 */
    @Test
    void singleValueValidatorComparesDictValueIgnoringCase() throws Exception {
        singleValueValidator.initialize(annotationOf(FlagValueHolder.class, "value"));

        assertThat(singleValueValidator.isValid("y", new RecordingContext(DEFAULT_TEMPLATE))).isTrue();
        assertThat(singleValueValidator.isValid("Y", new RecordingContext(DEFAULT_TEMPLATE))).isTrue();
        assertThat(singleValueValidator.isValid("N", new RecordingContext(DEFAULT_TEMPLATE))).isTrue();

        RecordingContext failing = new RecordingContext(DEFAULT_TEMPLATE);
        assertThat(singleValueValidator.isValid("X", failing)).as("未登记取值仍然拒绝").isFalse();
        assertThat(failing.violationTemplate).isEqualTo("必须在指定范围 Y,N");
    }

    /** 字典类型未登记任何取值时范围为空，任何非空取值都被拒且提示为空范围。 */
    @Test
    void singleValueValidatorRejectsEverythingWhenDictTypeHasNoValue() throws Exception {
        singleValueValidator.initialize(annotationOf(UnknownDictValueHolder.class, "value"));

        RecordingContext failing = new RecordingContext(DEFAULT_TEMPLATE);
        assertThat(singleValueValidator.isValid("1", failing)).isFalse();
        assertThat(failing.violationTemplate).isEqualTo("必须在指定范围 ");
    }

    /** 集合校验：null 与空集合放行，全部元素在范围内才通过，越界时列出字典值。 */
    @Test
    void collectionValidatorChecksEveryElementAndAllowsEmptyCollection() throws Exception {
        collectionValidator.initialize(annotationOf(SexCollectionHolder.class, "values"));

        RecordingContext passing = new RecordingContext(DEFAULT_TEMPLATE);
        assertThat(collectionValidator.isValid(null, passing)).as("null 集合交由必填注解处理").isTrue();
        assertThat(collectionValidator.isValid(new ArrayList<>(), passing)).as("空集合属于未填写，不得判为越界")
                .isTrue();
        assertThat(collectionValidator.isValid(Arrays.asList("1", "2"), passing)).isTrue();
        assertThat(passing.violationTemplate).as("通过时不得构造任何违规提示").isNull();

        RecordingContext failing = new RecordingContext(DEFAULT_TEMPLATE);
        assertThat(collectionValidator.isValid(Arrays.asList("1", "3"), failing)).isFalse();
        assertThat(failing.defaultViolationDisabled).isTrue();
        assertThat(failing.violationTemplate).isEqualTo("必须在指定范围 1,2");
        assertThat(failing.constraintViolationAdded).isTrue();
    }

    /** 集合内出现 null 元素视为越界，不能因“空值放行”而放过集合中的空元素。 */
    @Test
    void collectionValidatorRejectsNullElement() throws Exception {
        collectionValidator.initialize(annotationOf(SexCollectionHolder.class, "values"));

        RecordingContext failing = new RecordingContext(DEFAULT_TEMPLATE);
        assertThat(collectionValidator.isValid(Arrays.asList("1", null), failing)).isFalse();
        assertThat(failing.violationTemplate).isEqualTo("必须在指定范围 1,2");
    }

    /** 读取夹具字段上的真实注解实例，保证 initialize 收到的是注解声明的字典类型。 */
    private static InDict annotationOf(Class<?> holderType, String fieldName) throws Exception {
        Field field = holderType.getDeclaredField(fieldName);
        return field.getAnnotation(InDict.class);
    }

    /** 可控字典接口替身：登记性别与开关两个字典类型，其余类型返回空列表。 */
    private static DictDataCommonApi dictDataApi() {
        return dictType -> switch (dictType) {
            case "sys_sex" -> List.of(dictData("男", "1"), dictData("女", "2"));
            case "sys_flag" -> List.of(dictData("是", "Y"), dictData("否", "N"));
            default -> List.of();
        };
    }

    /** 构造字典数据，仅填充校验所需的字典值。 */
    private static DictDataRespDTO dictData(String label, String value) {
        DictDataRespDTO dictData = new DictDataRespDTO();
        dictData.setLabel(label);
        dictData.setValue(value);
        return dictData;
    }

    /** 注解声明的默认提示模板，与 {@link InDict#message()} 的默认值一致。 */
    private static final String DEFAULT_TEMPLATE = "必须在指定范围 {value}";

    /**
     * 记录容器调用的校验上下文替身，只实现被测校验器实际使用的能力。
     *
     * <p>真实容器会把 {@link #buildConstraintViolationWithTemplate(String)} 的模板插入违规消息；
     * 本替身保留模板原文与“是否加入违规”两项事实，供用例断言提示内容与调用顺序。</p>
     */
    private static class RecordingContext implements ConstraintValidatorContext {

        /** 注解声明的默认提示模板，与真实容器的读取结果一致。 */
        private final String defaultMessageTemplate;

        /** 是否调用过禁用默认提示。 */
        private boolean defaultViolationDisabled;

        /** 最近一次构造的自定义提示模板；未构造时为 null。 */
        private String violationTemplate;

        /** 是否调用过添加违规。 */
        private boolean constraintViolationAdded;

        /**
         * 构造记录型上下文。
         *
         * @param defaultMessageTemplate 注解声明的默认提示模板
         */
        RecordingContext(String defaultMessageTemplate) {
            this.defaultMessageTemplate = defaultMessageTemplate;
        }

        /** 记录默认提示已被禁用。 */
        @Override
        public void disableDefaultConstraintViolation() {
            defaultViolationDisabled = true;
        }

        /**
         * 返回注解声明的默认提示模板。
         *
         * @return 默认提示模板
         */
        @Override
        public String getDefaultConstraintMessageTemplate() {
            return defaultMessageTemplate;
        }

        /**
         * 本替身不支持读取时钟提供方。
         *
         * @return 不会返回
         */
        @Override
        public ClockProvider getClockProvider() {
            throw new UnsupportedOperationException("测试替身不支持时钟提供方");
        }

        /**
         * 记录自定义提示模板并返回违规构造器。
         *
         * @param messageTemplate 校验器构造的提示模板
         * @return 记录型违规构造器
         */
        @Override
        public ConstraintViolationBuilder buildConstraintViolationWithTemplate(String messageTemplate) {
            this.violationTemplate = messageTemplate;
            return new RecordingViolationBuilder();
        }

        /**
         * 本替身不支持解包为提供方类型。
         *
         * @param type 目标类型
         * @param <T> 目标类型
         * @return 不会返回
         */
        @Override
        public <T> T unwrap(Class<T> type) {
            throw new UnsupportedOperationException("测试替身不支持解包");
        }

        /** 记录型违规构造器：被测校验器只使用添加违规能力。 */
        private class RecordingViolationBuilder implements ConstraintViolationBuilder {

            /**
             * 本替身不支持自定义节点路径。
             *
             * @param name 节点名
             * @return 不会返回
             */
            @Override
            public NodeBuilderDefinedContext addNode(String name) {
                throw new UnsupportedOperationException("测试替身不支持自定义节点");
            }

            /**
             * 本替身不支持自定义属性节点。
             *
             * @param name 属性名
             * @return 不会返回
             */
            @Override
            public NodeBuilderCustomizableContext addPropertyNode(String name) {
                throw new UnsupportedOperationException("测试替身不支持自定义节点");
            }

            /**
             * 本替身不支持自定义 Bean 节点。
             *
             * @return 不会返回
             */
            @Override
            public LeafNodeBuilderCustomizableContext addBeanNode() {
                throw new UnsupportedOperationException("测试替身不支持自定义节点");
            }

            /**
             * 本替身不支持容器元素节点。
             *
             * @param name 节点名
             * @param containerType 容器类型
             * @param typeArgumentIndex 类型参数下标
             * @return 不会返回
             */
            @Override
            public ContainerElementNodeBuilderCustomizableContext addContainerElementNode(
                    String name, Class<?> containerType, Integer typeArgumentIndex) {
                throw new UnsupportedOperationException("测试替身不支持自定义节点");
            }

            /**
             * 本替身不支持参数节点。
             *
             * @param index 参数下标
             * @return 不会返回
             */
            @Override
            public NodeBuilderDefinedContext addParameterNode(int index) {
                throw new UnsupportedOperationException("测试替身不支持自定义节点");
            }

            /**
             * 记录违规已加入。
             *
             * @return 记录型上下文
             */
            @Override
            public ConstraintValidatorContext addConstraintViolation() {
                constraintViolationAdded = true;
                return RecordingContext.this;
            }
        }
    }

    /** 性别字典的单值入参夹具。 */
    private static class SexValueHolder {

        /** 待校验字典值，null 表示未填写。 */
        @InDict(type = "sys_sex")
        private String value;
    }

    /** 开关字典的单值入参夹具，字典值为字母，用于验证忽略大小写比较。 */
    private static class FlagValueHolder {

        /** 待校验字典值，null 表示未填写。 */
        @InDict(type = "sys_flag")
        private String value;
    }

    /** 未登记字典类型的单值入参夹具，用于验证空范围边界。 */
    private static class UnknownDictValueHolder {

        /** 待校验字典值，null 表示未填写。 */
        @InDict(type = "unused_type")
        private String value;
    }

    /** 性别字典的集合入参夹具，对应“批量设置”一类接口。 */
    private static class SexCollectionHolder {

        /** 待校验字典值集合，null 表示未填写。 */
        @InDict(type = "sys_sex")
        private List<String> values;
    }

}
