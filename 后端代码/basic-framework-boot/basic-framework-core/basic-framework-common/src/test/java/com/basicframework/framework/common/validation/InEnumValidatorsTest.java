package com.basicframework.framework.common.validation;

import com.basicframework.framework.common.core.ArrayValuable;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证单值与集合两种枚举范围校验器的真实契约。
 *
 * <p>该注解把“取值范围来自枚举”变成可声明的约束：取值范围由枚举的
 * {@link ArrayValuable#array()} 决定，空值放行（是否必填由 {@code @NotNull} 负责），
 * 越界时把默认提示里的 {@code {value}} 替换成实际范围，使前端能直接展示可选值。
 * 集合入口额外承担“逐个元素都必须在范围内”的语义，并且空集合属于“未填写”
 * 而不是越界，这条差异决定前端提交空列表时是否被误判为非法。</p>
 *
 * <p>这里通过真实 Bean Validation 触发 {@code initialize} 与 {@code isValid}，
 * 从而锁定“枚举未登记任何取值时范围为空、任何非空取值都被拒”的边界，
 * 而不是直接调用校验器绕过注解装配。</p>
 *
 * @author shady2713
 */
class InEnumValidatorsTest {

    private static ValidatorFactory validatorFactory;
    private static Validator validator;

    /** 建立真实 JSR-303 校验器，使校验器的注解装配路径与生产一致。 */
    @BeforeAll
    static void setUpValidator() {
        validatorFactory = Validation.buildDefaultValidatorFactory();
        validator = validatorFactory.getValidator();
    }

    /** 关闭校验器工厂，避免线程资源残留。 */
    @AfterAll
    static void closeValidator() {
        if (validatorFactory != null) {
            validatorFactory.close();
        }
    }

    /** 单值校验：空值放行，范围内取值放行，越界取值给出替换后的范围提示。 */
    @Test
    void singleValueValidatorAllowsNullAndRejectsValueOutOfRange() {
        assertThat(violations(new SingleValueHolder(null))).as("空值交由必填注解处理").isEmpty();
        assertThat(violations(new SingleValueHolder(CommonStatusEnum.ENABLE.getStatus()))).isEmpty();
        assertThat(violations(new SingleValueHolder(CommonStatusEnum.DISABLE.getStatus()))).isEmpty();

        Set<ConstraintViolation<SingleValueHolder>> violations = violations(new SingleValueHolder(2));
        assertThat(violations).hasSize(1);
        assertThat(violations.iterator().next().getMessage())
                .as("提示必须替换为真实取值范围，供前端展示可选值")
                .isEqualTo("状态必须在指定范围 [0, 1]");
    }

    /** 集合校验：null 与空集合都放行，全部元素在范围内才通过，越界时列出提交值。 */
    @Test
    void collectionValidatorChecksEveryElementAndAllowsEmptyCollection() {
        assertThat(violations(new CollectionHolder(null))).as("null 集合交由必填注解处理").isEmpty();
        assertThat(violations(new CollectionHolder(new ArrayList<>())))
                .as("空集合属于未填写，不得判为越界").isEmpty();
        assertThat(violations(new CollectionHolder(Arrays.asList(0, 1)))).isEmpty();

        Set<ConstraintViolation<CollectionHolder>> violations =
                violations(new CollectionHolder(Arrays.asList(0, 2)));
        assertThat(violations).hasSize(1);
        assertThat(violations.iterator().next().getMessage())
                .as("提示列出提交的取值，便于定位越界元素")
                .isEqualTo("状态必须在指定范围 0,2");
    }

    /** 枚举尚未登记任何取值时范围为空的单值边界：任何非空取值都被拒，空值仍放行。 */
    @Test
    void singleValueValidatorRejectsEverythingWhenEnumHasNoConstant() {
        Set<ConstraintViolation<EmptyRangeValueHolder>> violations =
                violations(new EmptyRangeValueHolder(0));
        assertThat(violations).hasSize(1);
        assertThat(violations.iterator().next().getMessage()).isEqualTo("必须在指定范围 []");
        assertThat(violations(new EmptyRangeValueHolder(null))).isEmpty();
    }

    /** 枚举尚未登记任何取值时范围为空的集合边界：非空集合被拒并列出提交值。 */
    @Test
    void collectionValidatorRejectsNonEmptyCollectionWhenEnumHasNoConstant() {
        Set<ConstraintViolation<EmptyRangeCollectionHolder>> violations =
                violations(new EmptyRangeCollectionHolder(Arrays.asList(0)));
        assertThat(violations).hasSize(1);
        assertThat(violations.iterator().next().getMessage()).isEqualTo("必须在指定范围 0");
        assertThat(violations(new EmptyRangeCollectionHolder(new ArrayList<>()))).isEmpty();
    }

    /** 触发真实校验并返回违规集合，避免测试自行调用校验器绕过注解装配。 */
    private static <T> Set<ConstraintViolation<T>> violations(T holder) {
        return validator.validate(holder);
    }

    /** 单值状态入参夹具，对应“一个字段只能取一个状态码”的接口。 */
    private static class SingleValueHolder {

        /** 待校验状态码，null 表示未填写。 */
        @InEnum(value = CommonStatusEnum.class, message = "状态必须在指定范围 {value}")
        private final Integer status;

        /**
         * 构造持有指定状态码的夹具。
         *
         * @param status 状态码，null 表示未填写
         */
        SingleValueHolder(Integer status) {
            this.status = status;
        }
    }

    /** 集合状态入参夹具，对应“批量设置状态”一类接口。 */
    private static class CollectionHolder {

        /** 待校验状态码集合，null 表示未填写。 */
        @InEnum(value = CommonStatusEnum.class, message = "状态必须在指定范围 {value}")
        private final List<Integer> statuses;

        /**
         * 构造持有指定状态码集合的夹具。
         *
         * @param statuses 状态码集合，null 表示未填写
         */
        CollectionHolder(List<Integer> statuses) {
            this.statuses = statuses;
        }
    }

    /** 单值夹具，使用尚未登记任何取值的枚举，用于验证空范围边界。 */
    private static class EmptyRangeValueHolder {

        /** 待校验取值，null 表示未填写。 */
        @InEnum(NoConstantEnum.class)
        private final Integer value;

        /**
         * 构造持有指定取值的夹具。
         *
         * @param value 待校验取值，null 表示未填写
         */
        EmptyRangeValueHolder(Integer value) {
            this.value = value;
        }
    }

    /** 集合夹具，使用尚未登记任何取值的枚举，用于验证空范围集合边界。 */
    private static class EmptyRangeCollectionHolder {

        /** 待校验取值集合，null 表示未填写。 */
        @InEnum(NoConstantEnum.class)
        private final List<Integer> values;

        /**
         * 构造持有指定取值集合的夹具。
         *
         * @param values 待校验取值集合，null 表示未填写
         */
        EmptyRangeCollectionHolder(List<Integer> values) {
            this.values = values;
        }
    }

    /** 尚未登记任何取值的枚举夹具，模拟新枚举只声明类而取值范围仍为空的阶段。 */
    private enum NoConstantEnum implements ArrayValuable<Integer> {

        ;

        /**
         * 返回空取值范围。
         *
         * @return 长度为 0 的取值数组
         */
        @Override
        public Integer[] array() {
            return new Integer[0];
        }
    }

}
