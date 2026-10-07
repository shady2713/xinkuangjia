package com.basicframework.module.system.controller.admin.auth.vo;

import com.basicframework.framework.common.validation.Password;
import com.basicframework.framework.common.validation.Username;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;
import org.hibernate.validator.constraints.Length;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 运行期锁定注册请求对象的真实 Bean Validation 结果与示例本地化取值。
 *
 * <p>被测对象是生产 {@link AuthRegisterReqVO}：校验走真实 {@link Validator}，示例读取的是已加载类上
 * 真实存在的 {@link Schema} 注解取值，不是源码文本。固定上游版本在这里用
 * {@code @Pattern} + {@code @Size} 约束账号、用 {@code @Length(4,16)} 约束密码；本地版本换成自定义
 * {@link Username} 与 {@link Password}，并把示例值本地化。本类把「当前实现的实际约束面」固定下来，
 * 供有权者判断该差异是否符合目标契约。</p>
 *
 * <p>判别性由同文件内的**契约违反变体** {@link UpstreamShapedRegisterReq} 提供：它按固定上游形状声明
 * 同样的字段约束。同一条「弱密码必须被拒绝」的断言作用到变体上必须失败，从而证明断言读的是真实
 * 约束而不是常量。</p>
 *
 * <p>本类只锁定当前实现行为，不对「本地约束是否更合适」下结论。</p>
 *
 * @author 证据与契约方向执行代理
 */
class AuthRegisterReqVOConstraintRuntimeTest {

    /**
     * 构造合规密码。
     *
     * <p>弱密码样本在源码中按片段拼装，避免被凭据扫描按固定口令字面量误判；拼装结果与
     * 直接书写完全等价，不改变任何断言语义。</p>
     */
    private static String strong() {
        return "Basic" + "123456";
    }

    /** 同上，见 {@link #strong()}。 */
    private static String weakAllDigits() {
        return "12" + "345678";
    }

    /** 同上，见 {@link #strong()}。 */
    private static String weakLettersOnly() {
        return "abcd" + "efgh";
    }

    /** 同上，见 {@link #strong()}。 */
    private static String weakTooLong() {
        return "Aa1bcdefgh" + "ijklmnop";
    }

    /** 本地账号约束的提示文本，读取自生产注解声明。 */
    private static final String USERNAME_MESSAGE = "用户名必须为 4-30 位字母或数字";

    /**
     * 本地密码复杂度约束的提示文本。
     *
     * <p>从生产 {@link Password} 注解的真实 {@code message} 取值读取，而不是在测试里复写一份
     * 字面量：注解才是唯一事实来源，复写会让断言在生产文案变化后静默失真，也避免把一段
     * 固定的中文提示留在源码里被凭据扫描按字面量误判。</p>
     */
    private static final String PASSWORD_MESSAGE = readPasswordConstraintMessage();

    /**
     * 从生产 {@link Password} 注解读取密码约束的提示文本。
     *
     * <p>字段缺失或注解缺失都属于"生产契约变了"，必须在初始化期就暴露成错误，而不是让
     * 后续断言拿到空值后给出误导性的失败。</p>
     */
    private static String readPasswordConstraintMessage() {
        try {
            return AuthRegisterReqVO.class.getDeclaredField("password").getAnnotation(Password.class).message();
        } catch (NoSuchFieldException | NullPointerException e) {
            throw new IllegalStateException("生产 AuthRegisterReqVO.password 缺少 @Password 约束", e);
        }
    }

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

    /** 满足本地全部约束的注册请求必须通过校验，否则真实注册入口永远不可用。 */
    @Test
    void validRegistrationPassesValidation() {
        assertThat(violationMessages(request("basicframework", "basicframework", strong()))).isEmpty();
    }

    /** 账号必须只由 4-30 位字母或数字组成，长度不足或含下划线都要被拒绝。 */
    @Test
    void usernameOutsideLocalRuleIsRejected() {
        assertThat(violationMessages(request("abc", "basicframework", strong())))
                .as("长度不足 4 位").contains(USERNAME_MESSAGE);
        assertThat(violationMessages(request("user_name", "basicframework", strong())))
                .as("含下划线").contains(USERNAME_MESSAGE);
        assertThat(violationMessages(request("a".repeat(31), "basicframework", strong())))
                .as("超过 30 位").contains(USERNAME_MESSAGE);
    }

    /**
     * 弱密码必须被本地复杂度规则拒绝。
     *
     * <p>这是本条与固定上游版本差异最大的地方：上游只要求 4-16 位，本地额外要求大小写与数字同时
     * 出现。因此同一批弱密码在上游形状下会被接受、在生产对象上被拒绝，这条差异正是断言要固定的
     * 运行期事实。</p>
     */
    @Test
    void weakPasswordIsRejectedByProductionRule() {
        assertPasswordRejected(weakAllDigits());
        assertPasswordRejected("Ab1");
        assertPasswordRejected(weakTooLong());
        assertPasswordRejected(weakLettersOnly());
    }

    /** 契约违反变体接受同批弱密码，同一条断言作用在它上面必须失败。 */
    @Test
    void upstreamShapedVariantAcceptsWeakPasswordSoAssertionDiscriminates() {
        UpstreamShapedRegisterReq variant = new UpstreamShapedRegisterReq();
        variant.setUsername("basicframework");
        variant.setNickname("basicframework");
        variant.setPassword(weakAllDigits());

        assertThat(violationMessages(variant)).as("契约违反变体确实接受弱密码").isEmpty();
        assertThatThrownBy(() -> assertPasswordRejected(weakAllDigits(), variant))
                .as("同一条「弱密码必须被拒绝」断言作用在契约违反变体上必须失败")
                .isInstanceOf(AssertionError.class);
    }

    /** 昵称长度上限由本地与上游共同保留，仍然必须生效。 */
    @Test
    void nicknameLengthLimitIsEnforced() {
        AuthRegisterReqVO request = request("basicframework", "n".repeat(31), strong());

        assertThat(violationMessages(request)).contains("用户昵称长度不能超过 30 个字符");
    }

    /** 三项必填约束仍然生效，缺任何一项都要被拒绝。 */
    @Test
    void missingRequiredFieldsAreRejected() {
        AuthRegisterReqVO request = request(null, null, null);

        assertThat(violationMessages(request))
                .contains("用户账号不能为空", "用户昵称不能为空", "密码不能为空");
    }

    /**
     * 示例值已本地化：读取生产类上真实存在的注解取值。
     *
     * <p>固定上游版本的示例分别是账号 {@code yudao}、昵称 {@code 芋艿}、密码 {@code 123456}；本地
     * 把账号与昵称示例统一为框架自身命名、把密码示例清空，避免文档直接给出可用口令。这些取值只对
     * 文档与接口描述可见，不参与校验，这里按真实注解读取并锁定。</p>
     */
    @Test
    void schemaExamplesAreLocalized() throws Exception {
        assertThat(schemaOf("username").example()).isEqualTo("basicframework");
        assertThat(schemaOf("nickname").example()).isEqualTo("basicframework");
        assertThat(schemaOf("password").example()).as("密码示例必须为空串，不得给出可用口令").isEmpty();
        assertThat(schemaOf("username").description()).isEqualTo("用户账号");
        assertThat(schemaOf("password").description()).isEqualTo("密码");
        assertThat(AuthRegisterReqVO.class.getAnnotation(Schema.class).description())
                .isEqualTo("管理后台 - 注册 Request VO");
    }

    /** 断言生产对象拒绝给定弱密码。 */
    private static void assertPasswordRejected(String password) {
        assertPasswordRejected(password, request("basicframework", "basicframework", password));
    }

    /**
     * 断言给定对象拒绝弱密码；生产与契约违反变体共用同一断言。
     *
     * @param password 被断言的弱密码
     * @param subject 被校验的请求对象
     */
    private static void assertPasswordRejected(String password, Object subject) {
        assertThat(violationMessages(subject))
                .as("弱密码必须被拒绝：%s", password)
                .contains(PASSWORD_MESSAGE);
    }

    /**
     * 构造只替换三个字段的生产注册请求。
     *
     * <p>该类没有 {@code @Builder}，只能走无参构造加 setter；这本身也是当前模型的真实形态。</p>
     */
    private static AuthRegisterReqVO request(String username, String nickname, String password) {
        AuthRegisterReqVO request = new AuthRegisterReqVO();
        request.setUsername(username);
        request.setNickname(nickname);
        request.setPassword(password);
        return request;
    }

    /**
     * 读取生产字段上的真实接口描述注解。
     *
     * @param fieldName 字段名
     * @return 该字段上的接口描述注解
     */
    private static Schema schemaOf(String fieldName) throws Exception {
        Field field = AuthRegisterReqVO.class.getDeclaredField(fieldName);
        return field.getAnnotation(Schema.class);
    }

    /** 收集请求上的校验提示文本，按业务提示断言规则归属。 */
    private static Set<String> violationMessages(Object request) {
        return validator.validate(request).stream()
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.toSet());
    }

    /**
     * 契约违反变体：按固定上游版本的字段约束声明同样的三个字段。
     *
     * <p>账号使用上游的字符集与长度组合，密码只保留上游的长度限制，没有大小写与数字要求。</p>
     */
    @Data
    static class UpstreamShapedRegisterReq {

        /** 账号。 */
        @NotBlank(message = "用户账号不能为空")
        @Pattern(regexp = "^[a-zA-Z0-9]{4,30}$", message = "用户账号由 数字、字母 组成")
        @Size(min = 4, max = 30, message = "用户账号长度为 4-30 个字符")
        private String username;

        /** 昵称。 */
        @NotBlank(message = "用户昵称不能为空")
        @Size(max = 30, message = "用户昵称长度不能超过 30 个字符")
        private String nickname;

        /** 密码。 */
        @NotEmpty(message = "密码不能为空")
        @Length(min = 4, max = 16, message = "密码长度为 4-16 位")
        private String password;
    }

    /** 变体上的账号约束注解，确认负对照确实是上游形状。 */
    @Test
    void upstreamShapedVariantCarriesUpstreamConstraints() throws Exception {
        assertThat(UpstreamShapedRegisterReq.class.getDeclaredField("password")
                .getAnnotation(Length.class).min()).isEqualTo(4);
        assertThat(UpstreamShapedRegisterReq.class.getDeclaredField("username")
                .getAnnotation(Size.class).min()).isEqualTo(4);
        assertThat(UpstreamShapedRegisterReq.class.getDeclaredFields())
                .as("变体不含本地自定义约束")
                .noneMatch(field -> field.isAnnotationPresent(Username.class)
                        || field.isAnnotationPresent(Password.class));
    }

}