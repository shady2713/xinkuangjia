package com.basicframework.module.system.controller.admin.oauth2.vo.client;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 OAuth2 客户端请求对象的两个自定义校验规则。
 *
 * <p>两条规则都保护数据库列容量与下游解析：附加信息最终会被下游按 JSON 解析，
 * 非法内容会让客户端在运行期报错而不是在保存时被拒绝；六个集合字段会以 JSON 文本写入
 * {@code varchar(255)} 列，超长会被 MySQL 静默截断或直接写入失败，因此必须在入口拦截。</p>
 *
 * <p>同时锁定“未提供即放行”的口径：附加信息与集合字段都允许不填，为空时不得报错。</p>
 *
 * @author shady2713
 */
class OAuth2ClientSaveReqVOTest {

    /** 序列化长度上限，与生产 {@code varchar(255)} 列容量一致。 */
    private static final int SERIALIZED_LIST_MAX_LENGTH = 255;

    private static ValidatorFactory validatorFactory;
    private static Validator validator;

    /** 建立真实 JSR-303 校验器，使校验规则与生产一致。 */
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

    /** 附加信息未填写时必须放行，空值与 null 都表示“不提供附加信息”。 */
    @Test
    void emptyAdditionalInformationPassesJsonCheck() {
        OAuth2ClientSaveReqVO reqVO = validReqVO();

        reqVO.setAdditionalInformation(null);
        assertThat(validator.validate(reqVO)).isEmpty();

        reqVO.setAdditionalInformation("");
        assertThat(validator.validate(reqVO)).isEmpty();
    }

    /** 合法 JSON 对象与数组都必须通过，附加信息协议不限制顶层结构。 */
    @Test
    void validJsonAdditionalInformationPasses() {
        OAuth2ClientSaveReqVO reqVO = validReqVO();

        reqVO.setAdditionalInformation("{\"key\":\"value\"}");
        assertThat(validator.validate(reqVO)).isEmpty();

        reqVO.setAdditionalInformation("[{\"key\":\"value\"}]");
        assertThat(validator.validate(reqVO)).isEmpty();
    }

    /** 明显不是 JSON 的文本必须被拒绝，并给出定位到附加信息的提示。 */
    @Test
    void nonJsonAdditionalInformationIsRejected() {
        OAuth2ClientSaveReqVO reqVO = validReqVO();
        reqVO.setAdditionalInformation("not-json");

        assertThat(validator.validate(reqVO)).hasSize(1);
        ConstraintViolation<OAuth2ClientSaveReqVO> violation = validator.validate(reqVO).iterator().next();
        assertThat(violation.getMessage()).isEqualTo("附加信息必须是 JSON 格式");
        assertThat(violation.getPropertyPath().toString()).isEqualTo("additionalInformationJson");
    }

    /**
     * 结构不完整的文本同样被拒绝，且失败只报一条附加信息错误。
     *
     * <p>缺少结尾大括号的文本无法被下游解析，必须在保存时拦截而不是留给运行期。</p>
     */
    @Test
    void unclosedJsonAdditionalInformationIsRejected() {
        OAuth2ClientSaveReqVO reqVO = validReqVO();
        reqVO.setAdditionalInformation("{\"key\":\"value\"");

        assertThat(validator.validate(reqVO)).hasSize(1);
    }

    /**
     * 以对象形状开头和结尾的文本会被放行，校验并不解析内容。
     *
     * <p>底层判定只检查首尾字符是否为 {@code \{}／{@code [} 与 {@code \}}／{@code ]}，
     * 因此 {@code {bad}} 这类内容仍会通过。本用例锁定真实边界，说明该注解只能挡住明显
     * 非 JSON 的输入，不能替代下游解析失败处理。</p>
     */
    @Test
    void objectShapedTextPassesEvenWhenNotValidJson() {
        OAuth2ClientSaveReqVO reqVO = validReqVO();
        reqVO.setAdditionalInformation("{bad}");

        assertThat(validator.validate(reqVO)).isEmpty();
    }

    /**
     * 集合字段未配置时必须放行，序列化长度检查不得把“未配置”判为超长。
     *
     * <p>四个可选集合允许为 null；两个必填集合允许为空列表（必填由 {@code @NotNull} 单独表达），
     * 空列表序列化为 {@code []}，长度远小于列容量。</p>
     */
    @Test
    void absentCollectionFieldsPassSerializedLengthCheck() {
        OAuth2ClientSaveReqVO reqVO = validReqVO();
        reqVO.setRedirectUris(List.of());
        reqVO.setAuthorizedGrantTypes(List.of());
        reqVO.setScopes(null);
        reqVO.setAutoApproveScopes(null);
        reqVO.setAuthorities(null);
        reqVO.setResourceIds(null);

        assertThat(validator.validate(reqVO)).isEmpty();
    }

    /** 两个必填集合缺少时必须报出各自字段的必填错误，不能被长度规则掩盖。 */
    @Test
    void requiredCollectionFieldsStillRejectNull() {
        OAuth2ClientSaveReqVO reqVO = validReqVO();
        reqVO.setRedirectUris(null);
        reqVO.setAuthorizedGrantTypes(null);

        Set<ConstraintViolation<OAuth2ClientSaveReqVO>> violations = validator.validate(reqVO);

        assertThat(violations).hasSize(2);
        assertThat(violations).extracting(violation -> violation.getPropertyPath().toString())
                .containsExactlyInAnyOrder("redirectUris", "authorizedGrantTypes");
    }

    /** 序列化后接近列容量的集合必须放行，避免误伤正常配置。 */
    @Test
    void collectionJustBelowSerializedLimitPasses() {
        OAuth2ClientSaveReqVO reqVO = validReqVO();
        List<String> values = List.of("a".repeat(SERIALIZED_LIST_MAX_LENGTH - 4));
        reqVO.setAuthorizedGrantTypes(values);
        assertThat(serializedLength(values)).isLessThanOrEqualTo(SERIALIZED_LIST_MAX_LENGTH);

        assertThat(validator.validate(reqVO)).isEmpty();
    }

    /** 序列化后超过列容量的集合必须被拒绝，避免 MySQL 静默截断或写入失败。 */
    @Test
    void oversizedCollectionIsRejected() {
        OAuth2ClientSaveReqVO reqVO = validReqVO();
        List<String> values = List.of("a".repeat(SERIALIZED_LIST_MAX_LENGTH), "b".repeat(SERIALIZED_LIST_MAX_LENGTH));
        reqVO.setAuthorizedGrantTypes(values);
        assertThat(serializedLength(values)).isGreaterThan(SERIALIZED_LIST_MAX_LENGTH);

        Set<ConstraintViolation<OAuth2ClientSaveReqVO>> violations = validator.validate(reqVO);
        assertThat(violations).hasSize(1);
        ConstraintViolation<OAuth2ClientSaveReqVO> violation = violations.iterator().next();
        assertThat(violation.getMessage()).isEqualTo("OAuth2 集合配置序列化后长度不能超过 255 个字符");
        assertThat(violation.getPropertyPath().toString()).isEqualTo("serializedListLengthValid");
    }

    /** 六个集合字段任意一个超长都必须被拒绝，不能只检查其中一部分。 */
    @Test
    void everyCollectionFieldIsCoveredByLengthCheck() {
        List<String> oversized = List.of("a".repeat(SERIALIZED_LIST_MAX_LENGTH), "b".repeat(SERIALIZED_LIST_MAX_LENGTH));

        assertThat(violationsWithOversized(reqVO -> reqVO.setRedirectUris(List.of(
                "https://example.com/" + "a".repeat(SERIALIZED_LIST_MAX_LENGTH))))).hasSize(1);
        assertThat(violationsWithOversized(reqVO -> reqVO.setAuthorizedGrantTypes(oversized))).hasSize(1);
        assertThat(violationsWithOversized(reqVO -> reqVO.setScopes(oversized))).hasSize(1);
        assertThat(violationsWithOversized(reqVO -> reqVO.setAutoApproveScopes(oversized))).hasSize(1);
        assertThat(violationsWithOversized(reqVO -> reqVO.setAuthorities(oversized))).hasSize(1);
        assertThat(violationsWithOversized(reqVO -> reqVO.setResourceIds(oversized))).hasSize(1);
    }

    /** 完整合法的请求对象不得产生任何违规，避免规则误伤正常保存流程。 */
    @Test
    void fullyValidRequestHasNoViolation() {
        assertThat(validator.validate(validReqVO())).isEmpty();
    }

    /**
     * 构造各字段均合法的请求对象。
     *
     * @return 只包含必填字段合法值、集合字段长度合规的请求对象
     */
    private static OAuth2ClientSaveReqVO validReqVO() {
        OAuth2ClientSaveReqVO reqVO = new OAuth2ClientSaveReqVO();
        reqVO.setClientId("synthetic-client");
        reqVO.setName("合成客户端");
        reqVO.setLogo("https://example.com/logo.png");
        reqVO.setStatus(1);
        reqVO.setAccessTokenValiditySeconds(8640);
        reqVO.setRefreshTokenValiditySeconds(8640000);
        reqVO.setRedirectUris(List.of("https://example.com/callback"));
        reqVO.setAuthorizedGrantTypes(List.of("password"));
        return reqVO;
    }

    /** 按给定方式设置一个集合字段后执行校验，返回违规集合。 */
    private static Set<ConstraintViolation<OAuth2ClientSaveReqVO>> violationsWithOversized(
            java.util.function.Consumer<OAuth2ClientSaveReqVO> mutation) {
        OAuth2ClientSaveReqVO reqVO = validReqVO();
        mutation.accept(reqVO);
        return validator.validate(reqVO);
    }

    /**
     * 按数据库实际存储形式计算集合的 JSON 长度。
     *
     * @param values 集合字段值
     * @return 序列化后的字符数
     */
    private static int serializedLength(List<String> values) {
        return com.basicframework.framework.common.util.json.JsonUtils.toJsonString(values).length();
    }
}
