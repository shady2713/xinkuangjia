package com.basicframework.module.system.controller.admin.auth.vo;

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
 * 验证短信找回密码请求只接受客户端提交的密码 MD5 摘要。
 *
 * <p>登录、个人改密与管理员重置都以 MD5 摘要为协议值，找回密码也必须一致：真实前端在
 * 提交前对原密码做 MD5，接口若按原密码规则校验摘要，任何 32 位摘要都会被判为不合规，
 * 找回入口永久失败；反过来放行原密码又会让存储摘要变成 BCrypt(原密码)，与登录提交的
 * BCrypt(MD5(原密码)) 不同源，用户同样无法登录。这里用真实 Bean Validation 锁定该契约：
 * 合法摘要通过，原密码与畸形摘要都被拒绝，必填约束仍然生效。</p>
 *
 * @author 李杰
 */
class AuthResetPasswordReqVOTest {

    /** 密码摘要的合法样例，取自 MD5 的稳定输出格式。 */
    private static final String DIGEST = "f6ec059b96fb8165879b4bc469b90016";

    /** 真实校验器工厂，本类独占并负责关闭。 */
    private static ValidatorFactory validatorFactory;
    /** 真实校验器，用于得到与接口入参校验一致的违规集合。 */
    private static Validator validator;

    /** 建立真实校验器，避免用直接调用校验方法代替容器校验。 */
    @BeforeAll
    static void createValidator() {
        validatorFactory = Validation.buildDefaultValidatorFactory();
        validator = validatorFactory.getValidator();
    }

    /** 关闭校验器工厂，释放其持有的资源。 */
    @AfterAll
    static void closeValidator() {
        if (validatorFactory != null) {
            validatorFactory.close();
        }
    }

    /** 客户端提交的 MD5 摘要必须通过校验，否则短信找回在真实前端调用下必然失败。 */
    @Test
    void clientDigestPassesValidation() {
        AuthResetPasswordReqVO request = request(DIGEST);

        assertThat(violationMessages(request)).isEmpty();
    }

    /** 原密码不符合摘要格式时必须被拒绝，避免存入与登录协议不同源的摘要。 */
    @Test
    void rawPasswordIsRejected() {
        AuthResetPasswordReqVO request = request("Passw0rd");

        assertThat(violationMessages(request)).contains("密码摘要必须为 32 位十六进制字符串");
    }

    /** 长度正确但含非十六进制字符的摘要必须被拒绝，格式约束不能只看长度。 */
    @Test
    void digestWithNonHexCharacterIsRejected() {
        AuthResetPasswordReqVO request = request("zfec059b96fb8165879b4bc469b90016");

        assertThat(violationMessages(request)).contains("密码摘要必须为 32 位十六进制字符串");
    }

    /** 缺少密码时按必填失败，不能因为放宽格式校验而允许空摘要写入。 */
    @Test
    void missingPasswordIsRejected() {
        AuthResetPasswordReqVO request = request(null);

        assertThat(violationMessages(request)).contains("密码不能为空");
    }

    /** 构造只替换密码、其余字段合法的请求。 */
    private static AuthResetPasswordReqVO request(String password) {
        return AuthResetPasswordReqVO.builder()
                .mobile("13100000000").code("654321").password(password).build();
    }

    /** 收集请求上的校验提示文本，按业务提示断言规则归属。 */
    private static Set<String> violationMessages(AuthResetPasswordReqVO request) {
        return validator.validate(request).stream()
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.toSet());
    }
}
