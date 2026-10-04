package com.basicframework.framework.common.pojo;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link PageParam} 的默认分页口径、不分页哨兵与页码/每页条数校验边界。
 *
 * <p>默认值决定未显式传参的列表接口返回多少数据；哨兵值被
 * {@code BaseMapperX#selectPage} 用来判断“不分页、直接查询全部”，取值一旦漂移，
 * 导出类查询会重新走分页或被误判为不分页。这里用真实 Bean Validation 校验器，
 * 与接口入参校验保持同一套约束。</p>
 *
 * @author shady2713
 */
class PageParamTest {

    /** 真实校验器工厂，本类独占并负责关闭。 */
    private static ValidatorFactory validatorFactory;
    /** 与接口入参一致的校验器。 */
    private static Validator validator;

    /** 建立真实校验器，避免用直接比较字段代替容器校验。 */
    @BeforeAll
    static void createValidator() {
        validatorFactory = Validation.buildDefaultValidatorFactory();
        validator = validatorFactory.getValidator();
    }

    /** 关闭校验器工厂，释放其持有的资源。 */
    @AfterAll
    static void closeValidator() {
        validatorFactory.close();
    }

    /** 新建的分页参数使用第 1 页、每页 10 条，与接口文档的默认口径一致。 */
    @Test
    void defaultPagingUsesFirstPageAndTenItems() {
        PageParam pageParam = new PageParam();

        assertThat(pageParam.getPageNo()).isEqualTo(1);
        assertThat(pageParam.getPageSize()).isEqualTo(10);
    }

    /**
     * 不分页哨兵固定为 -1，且与默认每页条数不同，调用方可以据此区分“按默认分页”和“查询全部”。
     */
    @Test
    void noPagingSentinelIsStable() {
        assertThat(PageParam.PAGE_SIZE_NONE).isEqualTo(-1);
        assertThat(PageParam.PAGE_SIZE_NONE).isNotEqualTo(new PageParam().getPageSize());
    }

    /** 默认值的分页参数通过校验，接口在完全不传参时不会因约束失败被拒绝。 */
    @Test
    void defaultPageParamPassesValidation() {
        assertThat(violations(new PageParam())).isEmpty();
    }

    /** 页码小于 1 与每页条数超出上限都必须被拒绝，否则会得到无意义的空页或超大结果集。 */
    @Test
    void outOfRangePagingIsRejected() {
        PageParam pageParam = new PageParam();
        pageParam.setPageNo(0);
        pageParam.setPageSize(201);

        assertThat(violations(pageParam))
                .containsExactlyInAnyOrderElementsOf(Set.of("pageNo", "pageSize"));
    }

    /** 页码与每页条数必须非空，缺失时不能按默认值静默放行。 */
    @Test
    void nullPagingIsRejected() {
        PageParam pageParam = new PageParam();
        pageParam.setPageNo(null);
        pageParam.setPageSize(null);

        assertThat(violations(pageParam))
                .containsExactlyInAnyOrderElementsOf(Set.of("pageNo", "pageSize"));
    }

    /**
     * 对分页参数执行真实校验，返回违规属性名集合。
     *
     * @param pageParam 待校验参数
     * @return 违规属性名；空集合表示通过校验
     */
    private Set<String> violations(PageParam pageParam) {
        Set<ConstraintViolation<PageParam>> result = validator.validate(pageParam);
        return result.stream().map(violation -> violation.getPropertyPath().toString()).collect(Collectors.toSet());
    }

}
