package com.basicframework.framework.common.util.validation;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.lang.Assert;
import org.springframework.util.StringUtils;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Validation;
import jakarta.validation.Validator;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 通用参数格式校验工具类。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public class ValidationUtils {

    private static final Pattern PATTERN_MOBILE = Pattern.compile("^1\\d{10}$");
    private static final Pattern PATTERN_URL = Pattern.compile("^(https?|ftp|file)://[-a-zA-Z0-9+&@#/%?=~_|!:,.;]*[-a-zA-Z0-9+&@#/%=~_|]");
    private static final Pattern PATTERN_XML_NCNAME = Pattern.compile("[a-zA-Z_][\\-_.0-9_a-zA-Z$]*");
    private static final Pattern PATTERN_USERNAME = Pattern.compile("^[A-Za-z0-9]{4,30}$");
    private static final Pattern PATTERN_PASSWORD = Pattern.compile("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)[A-Za-z\\d]{6,16}$");
    private static final Pattern PATTERN_EMAIL = Pattern.compile("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$");
    private static final Pattern PATTERN_ID_CARD = Pattern.compile("^[1-9]\\d{5}(18|19|20)\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\d{3}[0-9Xx]$");
    private static final Pattern PATTERN_REAL_NAME = Pattern.compile("^[A-Za-z\\u4e00-\\u9fa5·]{2,30}$");
    private static final Pattern PATTERN_BANK_CARD_NO = Pattern.compile("^\\d{12,19}$");
    private static final Pattern PATTERN_PERCENT = Pattern.compile("^(100(?:\\.0{1,2})?|\\d{1,2}(?:\\.\\d{1,2})?)$");
    private static final int[] ID_CARD_WEIGHT_FACTORS = {7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2};
    private static final char[] ID_CARD_CHECK_CODES = {'1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'};
    private static final DateTimeFormatter ID_CARD_BIRTHDAY_FORMATTER = DateTimeFormatter.ofPattern("yyyyMMdd");

    /** Luhn 算法单位数字进位阈值：乘 2 后超过 9 需要减 9。 */
    private static final int LUHN_DIGIT_CARRY_THRESHOLD = 9;

    /**
     * 校验手机号是否为 11 位大陆手机号格式。
     *
     * @param mobile 手机号
     * @return 是否格式正确
     */
    public static boolean isMobile(String mobile) {
        return StringUtils.hasText(mobile) && PATTERN_MOBILE.matcher(mobile).matches();
    }

    /**
     * 校验字符串是否为 URL 格式。
     *
     * @param url URL 字符串
     * @return 是否格式正确
     */
    public static boolean isURL(String url) {
        return StringUtils.hasText(url) && PATTERN_URL.matcher(url).matches();
    }

    /**
     * 校验字符串是否符合 XML NCName 命名规则。
     *
     * @param str 待校验字符串
     * @return 是否格式正确
     */
    public static boolean isXmlNCName(String str) {
        return StringUtils.hasText(str) && PATTERN_XML_NCNAME.matcher(str).matches();
    }

    /**
     * 校验用户名是否为 4-30 位字母或数字。
     *
     * @param username 用户名
     * @return 是否格式正确
     */
    public static boolean isUsername(String username) {
        return StringUtils.hasText(username) && PATTERN_USERNAME.matcher(username).matches();
    }

    /**
     * 校验密码是否为 6-16 位且同时包含大小写字母和数字。
     *
     * @param password 密码
     * @return 是否格式正确
     */
    public static boolean isPassword(String password) {
        return StringUtils.hasText(password) && PATTERN_PASSWORD.matcher(password).matches();
    }

    /**
     * 校验邮箱格式。
     *
     * @param email 邮箱地址
     * @return 是否格式正确
     */
    public static boolean isEmail(String email) {
        return StringUtils.hasText(email) && PATTERN_EMAIL.matcher(email).matches();
    }

    /**
     * 校验身份证号格式、出生日期和校验位。
     *
     * @param idCard 身份证号
     * @return 是否格式正确
     */
    public static boolean isIdCard(String idCard) {
        if (!StringUtils.hasText(idCard)) {
            return false;
        }
        String normalized = idCard.trim().toUpperCase();
        return PATTERN_ID_CARD.matcher(normalized).matches()
                && isValidIdCardBirthDate(normalized)
                && isValidIdCardChecksum(normalized);
    }

    /**
     * 校验真实姓名是否为 2-30 位中文、英文或中点。
     *
     * @param realName 真实姓名
     * @return 是否格式正确
     */
    public static boolean isRealName(String realName) {
        return StringUtils.hasText(realName) && PATTERN_REAL_NAME.matcher(realName).matches();
    }

    /**
     * 校验银行卡号格式和 Luhn 校验位。
     *
     * @param bankCardNo 银行卡号
     * @return 是否格式正确
     */
    public static boolean isBankCardNo(String bankCardNo) {
        return StringUtils.hasText(bankCardNo)
                && PATTERN_BANK_CARD_NO.matcher(bankCardNo).matches()
                && passesLuhnCheck(bankCardNo);
    }

    /**
     * 校验百分比字符串是否在 0-100 之间，且最多两位小数。
     *
     * @param percent 百分比字符串
     * @return 是否格式正确
     */
    public static boolean isPercent(String percent) {
        return StringUtils.hasText(percent) && PATTERN_PERCENT.matcher(percent).matches();
    }

    /**
     * 校验百分比数值是否在 0-100 之间，且最多两位小数。
     *
     * @param percent 百分比数值
     * @return 是否格式正确
     */
    public static boolean isPercent(Number percent) {
        if (percent == null) {
            return false;
        }
        return isPercent(stripTrailingZeros(new BigDecimal(percent.toString())));
    }

    /**
     * 校验数量是否为非负整数。
     *
     * @param quantity 数量
     * @return 是否格式正确
     */
    public static boolean isQuantity(Number quantity) {
        if (quantity == null) {
            return false;
        }
        BigDecimal value = new BigDecimal(quantity.toString());
        return value.compareTo(BigDecimal.ZERO) >= 0 && value.stripTrailingZeros().scale() <= 0;
    }

    /**
     * 使用默认 Bean Validation 校验器校验对象。
     *
     * @param object 待校验对象
     * @param groups 校验分组
     * @throws ConstraintViolationException 校验不通过时抛出
     */
    public static void validate(Object object, Class<?>... groups) {
        Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
        Assert.notNull(validator);
        validate(validator, object, groups);
    }

    /**
     * 使用指定 Bean Validation 校验器校验对象。
     *
     * @param validator 校验器
     * @param object 待校验对象
     * @param groups 校验分组
     * @throws ConstraintViolationException 校验不通过时抛出
     */
    public static void validate(Validator validator, Object object, Class<?>... groups) {
        Set<ConstraintViolation<Object>> constraintViolations = validator.validate(object, groups);
        if (CollUtil.isNotEmpty(constraintViolations)) {
            throw new ConstraintViolationException(constraintViolations);
        }
    }

    /**
     * 判断ValidIdCardBirthDate 是否满足业务条件。
     */
    private static boolean isValidIdCardBirthDate(String idCard) {
        try {
            LocalDate birthDate = LocalDate.parse(idCard.substring(6, 14), ID_CARD_BIRTHDAY_FORMATTER);
            return birthDate.getYear() >= 1900 && !birthDate.isAfter(LocalDate.now());
        } catch (DateTimeParseException ex) {
            return false;
        }
    }

    /**
     * 判断ValidIdCardChecksum 是否满足业务条件。
     */
    private static boolean isValidIdCardChecksum(String idCard) {
        int sum = 0;
        for (int i = 0; i < ID_CARD_WEIGHT_FACTORS.length; i++) {
            sum += Character.getNumericValue(idCard.charAt(i)) * ID_CARD_WEIGHT_FACTORS[i];
        }
        return ID_CARD_CHECK_CODES[sum % 11] == idCard.charAt(17);
    }

    /**
     * 使用 Luhn 算法校验银行卡号校验位。
     *
     * @param bankCardNo bankCardNo 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    private static boolean passesLuhnCheck(String bankCardNo) {
        int sum = 0;
        boolean doubleDigit = false;
        for (int i = bankCardNo.length() - 1; i >= 0; i--) {
            int digit = bankCardNo.charAt(i) - '0';
            if (doubleDigit) {
                digit *= 2;
                if (digit > LUHN_DIGIT_CARRY_THRESHOLD) {
                    digit -= LUHN_DIGIT_CARRY_THRESHOLD;
                }
            }
            sum += digit;
            doubleDigit = !doubleDigit;
        }
        return sum % 10 == 0;
    }

    /**
     * 移除TrailingZeros。
     *
     * @param value 待处理值
     * @return 方法处理结果
     */
    private static String stripTrailingZeros(BigDecimal value) {
        return value.stripTrailingZeros().toPlainString();
    }

}
