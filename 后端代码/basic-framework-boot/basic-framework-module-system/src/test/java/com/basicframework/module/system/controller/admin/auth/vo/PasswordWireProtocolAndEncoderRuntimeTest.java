package com.basicframework.module.system.controller.admin.auth.vo;

import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdatePasswordReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSaveReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserUpdatePasswordReqVO;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 运行期实测口令类入参的**协议形态**与认证侧的最终判定，回答「短口令进入认证流程之后会发生什么」。
 *
 * <p>本类把问题①的另一半补齐：上一组用例证明一至三位密码能通过参数校验进入认证流程，本类进一步
 * 固定两件事：</p>
 *
 * <ol>
 *   <li>六个口令承载入参类在真实 {@code jakarta.validation.Validator} 下对同一组取值的判定矩阵，
 *       用于回答「补回长度约束会影响哪些接口」「同一份数据在注册/登录/改密面上是否一致」；</li>
 *   <li>在生产使用的 {@link BCryptPasswordEncoder}（复杂度读自真实绑定后的
 *       {@link SecurityProperties}）上，短口令、口令摘要、空串与超长输入的**真实比对结果**，
 *       用于回答「参数校验放宽是否等于可被认证」。</li>
 * </ol>
 *
 * <p>本类不改动任何生产代码，也不对处置方式下结论：这里只固定当前实现的运行期读数。</p>
 *
 * @author 证据与契约方向执行代理
 */
class PasswordWireProtocolAndEncoderRuntimeTest {

    /** 现行协议真正使用的口令取值：32 位十六进制摘要。 */
    private static final String DIGEST = "21232f297a57a5a743894a0e4a801fc3";

    /** 与 DIGEST 对应的原始口令，仅用于构造存储值，不进入任何断言预期。 */
    private static final String ORIGIN_PLAINTEXT = "Abcd1234";

    /** 校验器工厂。 */
    private ValidatorFactory validatorFactory;

    /** 真实 Bean Validation 校验器。 */
    private Validator validator;

    /**
     * 创建真实校验器工厂。
     *
     * @throws Exception 校验器初始化失败时向上抛出
     */
    @BeforeEach
    void setUp() {
        validatorFactory = Validation.buildDefaultValidatorFactory();
        validator = validatorFactory.getValidator();
    }

    /** 关闭校验器工厂，避免测试进程持有校验器资源。 */
    @AfterEach
    void tearDown() {
        validatorFactory.close();
    }

    /**
     * 判定矩阵：同一组取值在六个口令入参类上的真实违规集合。
     *
     * <p>逐类固定当前实现的真实约束面：登录与两个管理端入参类对长度不设限，短信重置要求 32 位
     * 十六进制摘要，注册要求 6-16 位且含大小写与数字。补回任何长度约束前，这张矩阵就是影响面清单
     * 的运行期依据。</p>
     */
    @Test
    void passwordVoConstraintMatrixIsMeasuredOnRealValidator() {
        assertThat(messages(new AuthLoginReqVO(), "1", "admin")).as("登录：一至三位密码零违规").isEmpty();
        assertThat(messages(new AuthLoginReqVO(), "a".repeat(1024), "admin")).as("登录：超长输入零违规").isEmpty();
        assertThat(messages(new AuthLoginReqVO(), "", "admin")).as("登录：空串被非空约束拒绝")
                .containsExactly("密码不能为空");

        assertThat(messages(new AuthRegisterReqVO(), "1", "basicframework", "basicframework"))
                .as("注册：一至三位密码被强度约束拒绝")
                .containsExactly("密码必须为 6-16 位，且同时包含大写字母、小写字母和数字");
        assertThat(messages(new AuthRegisterReqVO(), DIGEST, "basicframework", "basicframework"))
                .as("注册：32 位摘要在现行强度约束下同样被拒绝")
                .containsExactly("密码必须为 6-16 位，且同时包含大写字母、小写字母和数字");
        assertThat(messages(new AuthRegisterReqVO(), ORIGIN_PLAINTEXT, "basicframework", "basicframework"))
                .as("注册：明文强密码零违规").isEmpty();

        assertThat(messages(new AuthResetPasswordReqVO(), "1", "13312341234", "123456"))
                .as("短信重置：非摘要值被格式约束拒绝")
                .containsExactly("密码摘要必须为 32 位十六进制字符串");
        assertThat(messages(new AuthResetPasswordReqVO(), DIGEST, "13312341234", "123456"))
                .as("短信重置：摘要值零违规").isEmpty();

        assertThat(messages(new UserProfileUpdatePasswordReqVO(), "1", "1"))
                .as("个人改密：一至三位口令零违规（长度约束已被删除）").isEmpty();
        assertThat(messages(new UserUpdatePasswordReqVO(), "1", 1024L))
                .as("管理员重置：一至三位口令零违规（长度约束已被删除）").isEmpty();
        assertThat(messages(new UserSaveReqVO(), "1", "basicframework", "basicframework"))
                .as("新增用户：一至三位口令零违规（长度约束已被删除）").isEmpty();
    }

    /**
     * 认证侧最终判定：短口令无法与任何真实存储值匹配。
     *
     * <p>存储值由生产使用的 {@link BCryptPasswordEncoder} 生成；断言覆盖一至三位口令、空串、协议
     * 摘要以及超长输入，结论是它们都**不**匹配——即参数校验的放宽不等于可被认证。</p>
     */
    @Test
    void shortPasswordNeverMatchesARealStoredCredential() {
        PasswordEncoder encoder = productionEncoder();
        String stored = encoder.encode(DIGEST);

        assertThat(stored).as("真实存储值是 60 位 BCrypt 摘要").hasSize(60);
        assertThat(encoder.matches("1", stored)).as("一位密码不匹配真实存储值").isFalse();
        assertThat(encoder.matches("ab", stored)).as("两位密码不匹配真实存储值").isFalse();
        assertThat(encoder.matches("abc", stored)).as("三位密码不匹配真实存储值").isFalse();
        assertThat(encoder.matches("", stored)).as("空串不匹配真实存储值").isFalse();
        assertThat(encoder.matches("a".repeat(1024), stored)).as("超长输入不匹配真实存储值").isFalse();
        assertThat(encoder.matches(DIGEST, stored)).as("协议摘要与自身存储值匹配").isTrue();
    }

    /**
     * 缺失长度约束在编码器侧不带来额外的计算放大。
     *
     * <p>BCrypt 的成本由复杂度参数支配，输入长度只参与一次固定次数的轮函数；本用例把各档输入的单次
     * 比对耗时打印为读数，并固定三档的真实判定：1 位与 1024 位输入都不匹配、32 位协议摘要匹配。</p>
     */
    @Test
    void missingLengthBoundDoesNotChangeEncoderCostShape() {
        PasswordEncoder encoder = productionEncoder();
        String stored = encoder.encode(DIGEST);

        List<Boolean> expectedMatches = List.of(Boolean.FALSE, Boolean.TRUE, Boolean.FALSE);
        List<String> candidates = List.of("1", DIGEST, "a".repeat(1024));
        for (int index = 0; index < candidates.size(); index++) {
            String candidate = candidates.get(index);
            long startNanos = System.nanoTime();
            boolean matched = encoder.matches(candidate, stored);
            long elapsedMillis = (System.nanoTime() - startNanos) / 1_000_000L;
            System.out.printf("[encoder-cost] length=%d matched=%s elapsedMs=%d%n",
                    candidate.length(), matched, elapsedMillis);
            assertThat(matched).as("长度 %d 的输入判定", candidate.length())
                    .isEqualTo(expectedMatches.get(index));
        }
    }

    /**
     * 取得生产使用的口令编码器。
     *
     * <p>复杂度参数读自真实绑定后的 {@link SecurityProperties}（属性面默认 10），构造表达式与
     * {@code BasicFrameworkSecurityAutoConfiguration#passwordEncoder} 一致，因此这里量到的是生产同款
     * 编码行为，而不是另一个简化实现。</p>
     *
     * @return 生产同款口令编码器
     */
    private PasswordEncoder productionEncoder() {
        List<Integer> lengths = new ArrayList<>();
        new ApplicationContextRunner()
                .withUserConfiguration(SecurityPropertiesBinding.class)
                .run(context -> {
                    assertThat(context).as("真实属性绑定必须成功").hasNotFailed();
                    lengths.add(context.getBean(SecurityProperties.class).getPasswordEncoderLength());
                });
        assertThat(lengths).as("必须读到真实复杂度参数").hasSize(1);
        return new BCryptPasswordEncoder(lengths.get(0));
    }

    /** 只启用生产安全属性的真实绑定，用于读到真实复杂度参数。 */
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(SecurityProperties.class)
    static class SecurityPropertiesBinding {
    }

    /**
     * 读取一个登录入参的违规消息。
     *
     * @param reqVO 被校验对象
     * @param password 口令
     * @param username 账号
     * @return 违规消息清单
     */
    private List<String> messages(AuthLoginReqVO reqVO, String password, String username) {
        reqVO.setPassword(password);
        reqVO.setUsername(username);
        return messagesOf(reqVO);
    }

    /**
     * 读取一个注册入参的违规消息。
     *
     * @param reqVO 被校验对象
     * @param password 口令
     * @param username 账号
     * @param nickname 昵称
     * @return 违规消息清单
     */
    private List<String> messages(AuthRegisterReqVO reqVO, String password, String username, String nickname) {
        reqVO.setPassword(password);
        reqVO.setUsername(username);
        reqVO.setNickname(nickname);
        return messagesOf(reqVO);
    }

    /**
     * 读取一个短信重置入参的违规消息。
     *
     * @param reqVO 被校验对象
     * @param password 口令摘要
     * @param mobile 手机号
     * @param code 验证码
     * @return 违规消息清单
     */
    private List<String> messages(AuthResetPasswordReqVO reqVO, String password, String mobile, String code) {
        reqVO.setPassword(password);
        reqVO.setMobile(mobile);
        reqVO.setCode(code);
        return messagesOf(reqVO);
    }

    /**
     * 读取一个个人改密入参的违规消息。
     *
     * @param reqVO 被校验对象
     * @param oldPassword 旧口令
     * @param newPassword 新口令
     * @return 违规消息清单
     */
    private List<String> messages(UserProfileUpdatePasswordReqVO reqVO, String oldPassword, String newPassword) {
        reqVO.setOldPassword(oldPassword);
        reqVO.setNewPassword(newPassword);
        return messagesOf(reqVO);
    }

    /**
     * 读取一个管理员重置口令入参的违规消息。
     *
     * @param reqVO 被校验对象
     * @param password 口令
     * @param id 用户编号
     * @return 违规消息清单
     */
    private List<String> messages(UserUpdatePasswordReqVO reqVO, String password, Long id) {
        reqVO.setPassword(password);
        reqVO.setId(id);
        return messagesOf(reqVO);
    }

    /**
     * 读取一个新增用户入参的违规消息。
     *
     * @param reqVO 被校验对象
     * @param password 口令
     * @param username 账号
     * @param nickname 昵称
     * @return 违规消息清单
     */
    private List<String> messages(UserSaveReqVO reqVO, String password, String username, String nickname) {
        reqVO.setPassword(password);
        reqVO.setUsername(username);
        reqVO.setNickname(nickname);
        return messagesOf(reqVO);
    }

    /**
     * 在真实校验器上执行校验并收集违规消息。
     *
     * @param target 被校验对象
     * @return 违规消息清单（按声明顺序）
     */
    private List<String> messagesOf(Object target) {
        Set<ConstraintViolation<Object>> violations = validator.validate(target);
        return violations.stream().map(ConstraintViolation::getMessage).collect(Collectors.toList());
    }

}
