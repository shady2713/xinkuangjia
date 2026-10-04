package com.basicframework.module.system.controller.admin.user.vo.user;

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
 * 验证用户创建/修改请求的密码必填边界。
 *
 * <p>同一个请求对象同时承担创建与修改：创建必须带密码，修改其他资料时允许不传密码保留原密码。
 * 边界一旦反向，创建出的账号没有可用密码（无法登录），或管理员每次改昵称都被强制重置密码。
 * 这里用真实 Bean Validation 校验请求，锁定两种场景下的违规集合差异。</p>
 *
 * @author shady2713
 */
class UserSaveReqVOTest {

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

    /** 创建用户（无编号）缺少密码时必须被拒绝，避免产出无法登录的账号。 */
    @Test
    void createWithoutPasswordIsRejected() {
        UserSaveReqVO request = request(null, null);

        assertThat(violationMessages(request)).contains("新增用户时密码不能为空");
    }

    /** 创建用户带密码时通过密码校验，说明规则没有把所有创建请求一并拒绝。 */
    @Test
    void createWithPasswordPassesPasswordRule() {
        UserSaveReqVO request = request(null, "5f4dcc3b5aa765d61d8327deb882cf99");

        assertThat(violationMessages(request)).doesNotContain("新增用户时密码不能为空");
    }

    /** 修改用户（带编号）允许不传密码，表示保留原密码而不是清空。 */
    @Test
    void updateWithoutPasswordStillPassesPasswordRule() {
        UserSaveReqVO request = request(1024L, null);

        assertThat(violationMessages(request)).doesNotContain("新增用户时密码不能为空");
    }

    /** 修改用户提交空串密码同样按“未提供”处理，维持三态语义中的不修改。 */
    @Test
    void updateWithBlankPasswordIsTreatedAsAbsent() {
        UserSaveReqVO request = request(1024L, "");

        assertThat(violationMessages(request)).doesNotContain("新增用户时密码不能为空");
    }

    /** 构造只替换编号与密码、其余字段合法的请求。 */
    private static UserSaveReqVO request(Long id, String password) {
        UserSaveReqVO request = new UserSaveReqVO();
        request.setId(id);
        request.setUsername("basicframework");
        request.setNickname("基础框架");
        request.setPassword(password);
        return request;
    }

    /** 收集请求上的校验提示文本，按业务提示断言规则归属。 */
    private static Set<String> violationMessages(UserSaveReqVO request) {
        return validator.validate(request).stream()
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.toSet());
    }
}
