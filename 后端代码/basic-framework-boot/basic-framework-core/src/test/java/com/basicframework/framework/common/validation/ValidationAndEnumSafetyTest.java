package com.basicframework.framework.common.validation;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.PageParam;
import com.basicframework.framework.common.pojo.SortingField;
import com.basicframework.framework.common.util.validation.ValidationUtils;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 校验工具、集合枚举校验器及分页排序边界回归测试。
 *
 * @author shady
 */
class ValidationAndEnumSafetyTest {

    private static Validator validator;

    @BeforeAll
    static void setUpValidator() {
        validator = Validation.buildDefaultValidatorFactory().getValidator();
    }

    @Test
    void usernameShouldAllowAlphanumericAndUnderscoreBetween4And30Chars() {
        assertThat(ValidationUtils.isUsername("user_a")).isTrue();
        assertThat(ValidationUtils.isUsername("Admin_01")).isTrue();
        assertThat(ValidationUtils.isUsername("abcd")).isTrue();
        assertThat(ValidationUtils.isUsername("a".repeat(30))).isTrue();

        assertThat(ValidationUtils.isUsername("abc")).isFalse();
        assertThat(ValidationUtils.isUsername("a".repeat(31))).isFalse();
        assertThat(ValidationUtils.isUsername("user-a")).isFalse();
        assertThat(ValidationUtils.isUsername("user a")).isFalse();
        assertThat(ValidationUtils.isUsername("用户01")).isFalse();
    }

    @Test
    void inEnumCollectionValidatorShouldReportAllowedValuesWithoutInterpolatingCallerInput() {
        SampleStatusCollection sample = new SampleStatusCollection(List.of("${1+1}", "bad$value\\x"));

        Set<ConstraintViolation<SampleStatusCollection>> violations = validator.validate(sample);

        assertThat(violations).hasSize(1);
        String message = violations.iterator().next().getMessage();
        assertThat(message)
                .contains("[0, 1]")
                .doesNotContain("2")
                .doesNotContain("${")
                .doesNotContain("bad$value");
    }

    @Test
    void pageParamAndSortingFieldShouldRejectBlankOrExcessiveSortingFields() {
        PageParam blankFieldParam = new PageParam();
        blankFieldParam.setSortingFields(List.of(new SortingField(null, "asc")));
        assertThat(validator.validate(blankFieldParam)).isNotEmpty();

        PageParam tooManyParam = new PageParam();
        tooManyParam.setSortingFields(List.of(
                new SortingField("id", "asc"),
                new SortingField("sort", "asc"),
                new SortingField("name", "asc"),
                new SortingField("status", "asc"),
                new SortingField("createTime", "desc"),
                new SortingField("updateTime", "desc")
        ));
        assertThat(validator.validate(tooManyParam))
                .extracting(ConstraintViolation::getMessage)
                .contains("排序字段最多支持 5 个");
    }

    private record SampleStatusCollection(
            @InEnum(value = CommonStatusEnum.class, message = "状态必须是 {value}")
            List<Object> statuses
    ) {
    }

}
