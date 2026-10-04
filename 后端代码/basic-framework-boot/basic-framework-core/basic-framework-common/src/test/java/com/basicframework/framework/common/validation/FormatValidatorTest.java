package com.basicframework.framework.common.validation;

import com.basicframework.framework.common.util.validation.ValidationUtils;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证各格式校验器在注解驱动与直接调用两条路径下的真实契约。
 *
 * <p>这组校验器只负责“格式是否合法”，是否必填由 {@code @NotNull} 等必填注解承担。
 * 若校验器把 null／空串一并判为非法，用户漏填字段时会收到“格式不正确”的误导提示，
 * 因此空值放行是刻意约定；但空白串（{@code " "}）不属于“未填写”，必须继续走格式规则，
 * 否则前端一个空格就能绕过全部格式校验。</p>
 *
 * <p>注解路径同时锁定失败提示文案，避免前端展示与注解声明漂移；直接调用路径锁定
 * 校验器与共享规则 {@link ValidationUtils} 结论一致，防止两处正则各自演化。</p>
 *
 * @author shady2713
 */
class FormatValidatorTest {

    private static ValidatorFactory validatorFactory;
    private static Validator validator;

    /** 建立真实 JSR-303 校验器，使注解路径与生产一致。 */
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

    /**
     * 银行卡号必须同时满足长度和 Luhn 校验位。
     *
     * <p>只校验位数会让任意 16 位数字通过；这里用“仅改动校验位”的负对照证明
     * Luhn 校验真实生效，而不是被长度规则掩盖。</p>
     */
    @Test
    void bankCardNoValidatesLengthAndLuhnChecksum() {
        assertThat(violations(new BankCardNoHolder("4111111111111111"))).isEmpty();
        assertThat(violations(new BankCardNoHolder("620000000005"))).as("12 位是允许的下边界").isEmpty();
        assertThat(violations(new BankCardNoHolder("6222020000000000000"))).as("19 位是允许的上边界").isEmpty();

        assertThat(violations(new BankCardNoHolder("4111111111111112")))
                .as("校验位错误必须拒绝").hasSize(1);
        assertThat(violations(new BankCardNoHolder("41111111111")))
                .as("少于 12 位必须拒绝").hasSize(1);
        assertThat(violations(new BankCardNoHolder("62220200000000000000")))
                .as("超过 19 位必须拒绝").hasSize(1);
        assertThat(violations(new BankCardNoHolder("4111 1111 1111 1111")))
                .as("含分隔符的卡号不属于本注解接受的格式").hasSize(1);

        BankCardNoValidator direct = new BankCardNoValidator();
        assertThat(direct.isValid("4111111111111111", null)).isTrue();
        assertThat(direct.isValid("4111111111111112", null)).isFalse();
        assertThat(violationMessage(new BankCardNoHolder("4111111111111112")))
                .isEqualTo("银行卡号必须为 12-19 位数字");
    }

    /** 邮箱必须满足本地部分、域名和顶级域名的完整结构，缺失顶级域名不接受。 */
    @Test
    void emailExValidatesMailboxStructure() {
        assertThat(violations(new EmailExHolder("user.name+tag@example.com"))).isEmpty();
        assertThat(violations(new EmailExHolder("USER_1%2@sub.example.co"))).isEmpty();

        assertThat(violations(new EmailExHolder("user@example")))
                .as("缺少顶级域名必须拒绝").hasSize(1);
        assertThat(violations(new EmailExHolder("user@example.c")))
                .as("顶级域名不足两位必须拒绝").hasSize(1);
        assertThat(violations(new EmailExHolder("user@@example.com"))).hasSize(1);
        assertThat(violations(new EmailExHolder("中文@example.com"))).hasSize(1);

        EmailExValidator direct = new EmailExValidator();
        assertThat(direct.isValid("user@example.com", null)).isTrue();
        assertThat(direct.isValid("user@example", null)).isFalse();
        assertThat(violationMessage(new EmailExHolder("user@example"))).isEqualTo("邮箱格式不正确");
    }

    /**
     * 身份证号必须同时满足结构、出生日期和校验位三项约束。
     *
     * <p>只匹配 18 位数字会让 {@code 20261301} 这类不存在的日期通过，
     * 也会放过任意改动的末位，因此这里分别用坏日期与坏校验位做负对照。</p>
     */
    @Test
    void idCardValidatesBirthDateAndChecksum() {
        assertThat(violations(new IdCardHolder("110101199003075533"))).isEmpty();
        assertThat(violations(new IdCardHolder("110101199003078881"))).isEmpty();

        assertThat(violations(new IdCardHolder("110101199003075534")))
                .as("校验位错误必须拒绝").hasSize(1);
        assertThat(violations(new IdCardHolder("110101199013075533")))
                .as("不存在的月份必须拒绝").hasSize(1);
        assertThat(violations(new IdCardHolder("110101189903075533")))
                .as("1900 年之前的出生日期必须拒绝").hasSize(1);
        assertThat(violations(new IdCardHolder("11010119900307553")))
                .as("17 位不是合法长度").hasSize(1);

        IdCardValidator direct = new IdCardValidator();
        assertThat(direct.isValid("110101199003075533", null)).isTrue();
        assertThat(direct.isValid("110101199003075534", null)).isFalse();
        assertThat(violationMessage(new IdCardHolder("110101199003075534"))).isEqualTo("身份证号格式不正确");
    }

    /** 手机号只接受 1 开头的 11 位数字，号段非法与长度非法都必须拒绝。 */
    @Test
    void mobileAcceptsOnlyElevenDigitMainlandNumbers() {
        assertThat(violations(new MobileHolder("13800000001"))).isEmpty();
        assertThat(violations(new MobileHolder("19900000001"))).isEmpty();

        assertThat(violations(new MobileHolder("1380000000"))).as("10 位必须拒绝").hasSize(1);
        assertThat(violations(new MobileHolder("138000000012"))).as("12 位必须拒绝").hasSize(1);
        assertThat(violations(new MobileHolder("23800000001"))).as("非 1 开头必须拒绝").hasSize(1);
        assertThat(violations(new MobileHolder("138-0000-0001"))).as("含分隔符必须拒绝").hasSize(1);

        MobileValidator direct = new MobileValidator();
        assertThat(direct.isValid("13800000001", null)).isTrue();
        assertThat(direct.isValid("23800000001", null)).isFalse();
        assertThat(violationMessage(new MobileHolder("23800000001"))).isEqualTo("手机号格式不正确");
    }

    /**
     * 真实姓名只接受 2-30 位中文、英文或中点，数字、空格和标点必须拒绝。
     *
     * <p>接受字符集不含空格，因此“John Smith”这类带空格的外文姓名会被拒绝；
     * 该限制来自注解声明的字符集，属既有口径，本用例锁定真实行为而不放宽。</p>
     */
    @Test
    void realNameAcceptsChineseEnglishAndMiddleDot() {
        assertThat(violations(new RealNameHolder("张三"))).isEmpty();
        assertThat(violations(new RealNameHolder("欧阳娜娜"))).isEmpty();
        assertThat(violations(new RealNameHolder("JohnSmith"))).isEmpty();
        assertThat(violations(new RealNameHolder("阿依古丽·买买提"))).as("少数民族姓名中的中点必须允许").isEmpty();
        assertThat(violations(new RealNameHolder("李".repeat(30)))).as("30 位是允许的上边界").isEmpty();

        assertThat(violations(new RealNameHolder("李"))).as("单字姓名不足 2 位").hasSize(1);
        assertThat(violations(new RealNameHolder("李".repeat(31)))).as("超过 30 位必须拒绝").hasSize(1);
        assertThat(violations(new RealNameHolder("张三3"))).as("含数字必须拒绝").hasSize(1);
        assertThat(violations(new RealNameHolder("张三-"))).as("含连字符必须拒绝").hasSize(1);
        assertThat(violations(new RealNameHolder("John Smith"))).as("空格不在接受字符集内").hasSize(1);

        RealNameValidator direct = new RealNameValidator();
        assertThat(direct.isValid("张三", null)).isTrue();
        assertThat(direct.isValid("张三3", null)).isFalse();
        assertThat(violationMessage(new RealNameHolder("张三3")))
                .isEqualTo("姓名必须为 2-30 位中文、英文或中点");
    }

    /**
     * 固话或手机号校验器接受座机、手机与 400／800 服务号。
     *
     * <p>实现直接复用 Hutool {@code PhoneUtil}，接受集合比“11 位手机号”宽：
     * 座机带区号与可选连字符、服务号也属于合法联系电话。这里锁定真实接受集合，
     * 避免后续误以为该注解等价于 {@link Mobile}。</p>
     */
    @Test
    void telephoneAcceptsLandlineMobileAndServiceNumbers() {
        assertThat(violations(new TelephoneHolder("010-12345678"))).as("带连字符座机必须接受").isEmpty();
        assertThat(violations(new TelephoneHolder("075512345678"))).as("不带连字符座机必须接受").isEmpty();
        assertThat(violations(new TelephoneHolder("13800000001"))).as("手机号必须接受").isEmpty();
        assertThat(violations(new TelephoneHolder("400-1234567"))).as("400 服务号必须接受").isEmpty();
        assertThat(violations(new TelephoneHolder("8001234567"))).as("800 服务号必须接受").isEmpty();

        assertThat(violations(new TelephoneHolder("010-123456789"))).as("座机号过长必须拒绝").hasSize(1);
        assertThat(violations(new TelephoneHolder("400-12345678"))).as("服务号位数错误必须拒绝").hasSize(1);
        assertThat(violations(new TelephoneHolder("0-12345678"))).as("缺少区号必须拒绝").hasSize(1);
        assertThat(violations(new TelephoneHolder("95588"))).as("短号不在接受集合内").hasSize(1);

        TelephoneValidator direct = new TelephoneValidator();
        assertThat(direct.isValid("010-12345678", null)).isTrue();
        assertThat(direct.isValid("95588", null)).isFalse();
        assertThat(violationMessage(new TelephoneHolder("95588"))).isEqualTo("电话格式不正确");
    }

    /** 用户名只接受 4-30 位字母或数字，长度边界与字符集都必须生效。 */
    @Test
    void usernameAcceptsFourToThirtyAlphanumeric() {
        assertThat(violations(new UsernameHolder("abcd"))).as("4 位是允许的下边界").isEmpty();
        assertThat(violations(new UsernameHolder("A1".repeat(15)))).as("30 位是允许的上边界").isEmpty();
        assertThat(violations(new UsernameHolder("Admin001"))).isEmpty();

        assertThat(violations(new UsernameHolder("abc"))).as("少于 4 位必须拒绝").hasSize(1);
        assertThat(violations(new UsernameHolder("a".repeat(31)))).as("超过 30 位必须拒绝").hasSize(1);
        assertThat(violations(new UsernameHolder("admin_01"))).as("下划线必须拒绝").hasSize(1);
        assertThat(violations(new UsernameHolder("管理员001"))).as("中文必须拒绝").hasSize(1);

        UsernameValidator direct = new UsernameValidator();
        assertThat(direct.isValid("Admin001", null)).isTrue();
        assertThat(direct.isValid("admin_01", null)).isFalse();
        assertThat(violationMessage(new UsernameHolder("admin_01")))
                .isEqualTo("用户名必须为 4-30 位字母或数字");
    }

    /**
     * 空值放行、空白串不放行，七个校验器必须保持同一口径。
     *
     * <p>放行空值是为了让“未填写”只由必填注解报错；空白串不是“未填写”，
     * 必须继续走格式规则，否则前端一个空格即可绕过格式校验。</p>
     */
    @Test
    void emptyValuePassesButBlankValueIsStillValidated() {
        assertThat(new BankCardNoValidator().isValid(null, null)).isTrue();
        assertThat(new BankCardNoValidator().isValid("", null)).isTrue();
        assertThat(new EmailExValidator().isValid(null, null)).isTrue();
        assertThat(new EmailExValidator().isValid("", null)).isTrue();
        assertThat(new IdCardValidator().isValid(null, null)).isTrue();
        assertThat(new IdCardValidator().isValid("", null)).isTrue();
        assertThat(new MobileValidator().isValid(null, null)).isTrue();
        assertThat(new MobileValidator().isValid("", null)).isTrue();
        assertThat(new RealNameValidator().isValid(null, null)).isTrue();
        assertThat(new RealNameValidator().isValid("", null)).isTrue();
        assertThat(new TelephoneValidator().isValid(null, null)).isTrue();
        assertThat(new TelephoneValidator().isValid("", null)).isTrue();
        assertThat(new UsernameValidator().isValid(null, null)).isTrue();
        assertThat(new UsernameValidator().isValid("", null)).isTrue();

        assertThat(new BankCardNoValidator().isValid(" ", null)).as("空白串不是未填写").isFalse();
        assertThat(new EmailExValidator().isValid(" ", null)).isFalse();
        assertThat(new IdCardValidator().isValid(" ", null)).isFalse();
        assertThat(new MobileValidator().isValid(" ", null)).isFalse();
        assertThat(new RealNameValidator().isValid(" ", null)).isFalse();
        assertThat(new TelephoneValidator().isValid(" ", null)).isFalse();
        assertThat(new UsernameValidator().isValid(" ", null)).isFalse();

        assertThat(violations(new MobileHolder(null))).as("必填由 @NotNull 负责，本注解放行 null").isEmpty();
        assertThat(violations(new UsernameHolder(""))).isEmpty();
    }

    /**
     * 直接调用校验器必须与共享规则给出相同结论，避免两处规则各自演化。
     *
     * <p>候选值覆盖正常、边界与非法三类，逐个与 {@link ValidationUtils} 对比，
     * 使任何单侧修改正则或算法的改动都会让本用例失败。</p>
     */
    @Test
    void directValidatorsAgreeWithSharedRules() {
        String[] candidates = {
                "4111111111111111", "620000000005", "6222020000000000000", "4111111111111112", "41111111111",
                "user@example.com", "user@example", "user@@example.com", "user.name+tag@example.com",
                "110101199003075533", "110101199003075534", "110101199013075533", "110101189903075533",
                "13800000001", "1380000000", "23800000001", "138000000012",
                "张三", "John Smith", "阿依古丽·买买提", "李", "张三3", "李".repeat(31),
                "abcd", "Admin001", "abc", "admin_01", "管理员001", "a".repeat(31)
        };
        BankCardNoValidator bankCardNo = new BankCardNoValidator();
        EmailExValidator emailEx = new EmailExValidator();
        IdCardValidator idCard = new IdCardValidator();
        MobileValidator mobile = new MobileValidator();
        RealNameValidator realName = new RealNameValidator();
        UsernameValidator username = new UsernameValidator();

        for (String candidate : candidates) {
            assertThat(bankCardNo.isValid(candidate, null))
                    .as("银行卡号候选值=%s 必须与共享规则一致", candidate)
                    .isEqualTo(ValidationUtils.isBankCardNo(candidate));
            assertThat(emailEx.isValid(candidate, null))
                    .as("邮箱候选值=%s 必须与共享规则一致", candidate)
                    .isEqualTo(ValidationUtils.isEmail(candidate));
            assertThat(idCard.isValid(candidate, null))
                    .as("身份证候选值=%s 必须与共享规则一致", candidate)
                    .isEqualTo(ValidationUtils.isIdCard(candidate));
            assertThat(mobile.isValid(candidate, null))
                    .as("手机号候选值=%s 必须与共享规则一致", candidate)
                    .isEqualTo(ValidationUtils.isMobile(candidate));
            assertThat(realName.isValid(candidate, null))
                    .as("姓名候选值=%s 必须与共享规则一致", candidate)
                    .isEqualTo(ValidationUtils.isRealName(candidate));
            assertThat(username.isValid(candidate, null))
                    .as("用户名候选值=%s 必须与共享规则一致", candidate)
                    .isEqualTo(ValidationUtils.isUsername(candidate));
        }
    }

    /** 执行校验并返回违规集合。 */
    private static <T> Set<ConstraintViolation<T>> violations(T holder) {
        return validator.validate(holder);
    }

    /** 执行校验并返回唯一一条失败提示，用于锁定注解文案。 */
    private static String violationMessage(Object holder) {
        Set<ConstraintViolation<Object>> result = validator.validate(holder);
        assertThat(result).as("样例对象必须恰好违反一条约束").hasSize(1);
        return result.iterator().next().getMessage();
    }

    /** 银行卡号校验样例对象。 */
    static class BankCardNoHolder {

        /** 待校验银行卡号。 */
        @BankCardNo
        private final String value;

        /** 构造样例对象。 */
        BankCardNoHolder(String value) {
            this.value = value;
        }

        /** 供校验框架读取属性。 */
        public String getValue() {
            return value;
        }
    }

    /** 邮箱校验样例对象。 */
    static class EmailExHolder {

        /** 待校验邮箱。 */
        @EmailEx
        private final String value;

        /** 构造样例对象。 */
        EmailExHolder(String value) {
            this.value = value;
        }

        /** 供校验框架读取属性。 */
        public String getValue() {
            return value;
        }
    }

    /** 身份证号校验样例对象。 */
    static class IdCardHolder {

        /** 待校验身份证号。 */
        @IdCard
        private final String value;

        /** 构造样例对象。 */
        IdCardHolder(String value) {
            this.value = value;
        }

        /** 供校验框架读取属性。 */
        public String getValue() {
            return value;
        }
    }

    /** 手机号校验样例对象。 */
    static class MobileHolder {

        /** 待校验手机号。 */
        @Mobile
        private final String value;

        /** 构造样例对象。 */
        MobileHolder(String value) {
            this.value = value;
        }

        /** 供校验框架读取属性。 */
        public String getValue() {
            return value;
        }
    }

    /** 真实姓名校验样例对象。 */
    static class RealNameHolder {

        /** 待校验姓名。 */
        @RealName
        private final String value;

        /** 构造样例对象。 */
        RealNameHolder(String value) {
            this.value = value;
        }

        /** 供校验框架读取属性。 */
        public String getValue() {
            return value;
        }
    }

    /** 电话校验样例对象。 */
    static class TelephoneHolder {

        /** 待校验电话。 */
        @Telephone
        private final String value;

        /** 构造样例对象。 */
        TelephoneHolder(String value) {
            this.value = value;
        }

        /** 供校验框架读取属性。 */
        public String getValue() {
            return value;
        }
    }

    /** 用户名校验样例对象。 */
    static class UsernameHolder {

        /** 待校验用户名。 */
        @Username
        private final String value;

        /** 构造样例对象。 */
        UsernameHolder(String value) {
            this.value = value;
        }

        /** 供校验框架读取属性。 */
        public String getValue() {
            return value;
        }
    }
}
