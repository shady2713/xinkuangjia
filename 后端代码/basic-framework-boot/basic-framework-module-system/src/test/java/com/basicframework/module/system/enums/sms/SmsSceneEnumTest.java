package com.basicframework.module.system.enums.sms;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证短信场景枚举的编码与数组暴露契约。
 *
 * <p>场景编号写入短信验证码表并参与频率限制与模板选择，{@code array()} 供接口参数校验枚举范围。
 * 两者都与用户端/管理端既有取值绑定：编号漂移会让已发出的验证码无法核销，
 * 数组缺项会让合法场景被参数校验拒绝。</p>
 *
 * @author shady2713
 */
class SmsSceneEnumTest {

    /** 会员与后台场景的编号必须与数据库既有取值一致。 */
    @Test
    void sceneCodesAreStable() {
        assertThat(SmsSceneEnum.MEMBER_LOGIN.getScene()).isEqualTo(1);
        assertThat(SmsSceneEnum.MEMBER_UPDATE_MOBILE.getScene()).isEqualTo(2);
        assertThat(SmsSceneEnum.MEMBER_UPDATE_PASSWORD.getScene()).isEqualTo(3);
        assertThat(SmsSceneEnum.MEMBER_RESET_PASSWORD.getScene()).isEqualTo(4);
        assertThat(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene()).isEqualTo(21);
        assertThat(SmsSceneEnum.ADMIN_MEMBER_REGISTER.getScene()).isEqualTo(22);
        assertThat(SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD.getScene()).isEqualTo(23);

        assertThat(SmsSceneEnum.values()).extracting(SmsSceneEnum::getScene).doesNotHaveDuplicates();
    }

    /** 模板编码与描述必须保留，模板编码是发送短信时选择模板的唯一依据。 */
    @Test
    void templateCodeAndDescriptionAreStable() {
        assertThat(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getTemplateCode()).isEqualTo("admin-sms-login");
        assertThat(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getDescription()).isEqualTo("后台用户 - 手机号登录");
    }

    /**
     * 数组入口必须覆盖全部场景编号，供参数校验的枚举范围使用。
     *
     * <p>数组缺项会让合法场景在接口层被拒绝，因此与 {@code values()} 逐一比对。</p>
     */
    @Test
    void arrayExposesEverySceneCode() {
        assertThat(SmsSceneEnum.ADMIN_MEMBER_LOGIN.array())
                .containsExactly(1, 2, 3, 4, 21, 22, 23);
        assertThat(SmsSceneEnum.ADMIN_MEMBER_LOGIN.array())
                .as("数组内容必须与枚举常量一一对应").hasSameSizeAs(SmsSceneEnum.values());
    }

    /** 按场景编号查询必须命中对应枚举，未登记编号返回 null 而不是抛错。 */
    @Test
    void getCodeBySceneMatchesKnownSceneOnly() {
        assertThat(SmsSceneEnum.getCodeByScene(21)).isSameAs(SmsSceneEnum.ADMIN_MEMBER_LOGIN);
        assertThat(SmsSceneEnum.getCodeByScene(4)).isSameAs(SmsSceneEnum.MEMBER_RESET_PASSWORD);
        assertThat(SmsSceneEnum.getCodeByScene(99)).isNull();
    }

}
