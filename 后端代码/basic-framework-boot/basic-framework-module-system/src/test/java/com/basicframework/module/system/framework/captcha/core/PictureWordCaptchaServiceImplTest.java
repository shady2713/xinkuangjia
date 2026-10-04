package com.basicframework.module.system.framework.captcha.core;

import com.anji.captcha.model.common.RepCodeEnum;
import com.anji.captcha.model.common.ResponseModel;
import com.anji.captcha.model.vo.CaptchaVO;
import com.anji.captcha.service.CaptchaCacheService;
import com.anji.captcha.service.impl.CaptchaServiceFactory;
import com.anji.captcha.service.impl.FrequencyLimitHandler;
import com.anji.captcha.util.AESUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证图片文字验证码的生成结果、一次性校验、二次校验与辅助方法契约。
 *
 * <p>该实现用 aj-captcha 的本地缓存承载"验证码值"和"二次校验凭据"两类状态，以下边界决定登录安全：
 * 生成必须返回可解码图片、非空 token，并把"文字,密钥"写入缓存，供后续校验读取；校验必须逐次消费
 * 缓存项（无论成功或失败都即刻失效），用户输入与缓存文字按忽略大小写比较；成功后必须把
 * {@code token---用户输入} 的 AES 密文写入二次校验键，供 {@code verification} 一次性消费；
 * 缓存内容损坏导致 AES 加密失败时必须返回失败响应而不是抛出异常，并保留可读的错误信息。</p>
 *
 * <p>用例通过 {@code CaptchaServiceFactory} 读取真实本地缓存中实现写入的值（不猜测随机文字），
 * 用同一密钥重算二次校验密文，因此断言的是实现自身写入与读取的键值契约，而不是替身行为。
 * 每个用例结束都会清理自己创建的缓存键，避免污染同 JVM 内的其他验证码用例。</p>
 *
 * @author shady2713
 */
class PictureWordCaptchaServiceImplTest {

    /** 缓存故障替身使用的固定异常信息，供断言核对降级响应是否回传原因。 */
    private static final String CACHE_FAILURE_MESSAGE = "DUMMY-CACHE-UNAVAILABLE";

    /** 被测验证码实现。 */
    private PictureWordCaptchaServiceImpl captchaService;
    /** 实现使用的缓存类型，与父类静态配置保持一致。 */
    private String cacheType;
    /** 第一类缓存键格式（验证码值）。 */
    private String captchaKeyFormat;
    /** 第二类缓存键格式（二次校验凭据）。 */
    private String secondCaptchaKeyFormat;
    /** 本用例写入的缓存键，结束后逐个清理。 */
    private final List<String> createdKeys = new ArrayList<>();

    /** 创建被测实例并读取父类静态键格式。 */
    @BeforeEach
    void setUp() {
        captchaService = new PictureWordCaptchaServiceImpl();
        cacheType = (String) ReflectionTestUtils.getField(PictureWordCaptchaServiceImpl.class, "cacheType");
        captchaKeyFormat = (String) ReflectionTestUtils.getField(PictureWordCaptchaServiceImpl.class,
                "REDIS_CAPTCHA_KEY");
        secondCaptchaKeyFormat = (String) ReflectionTestUtils.getField(PictureWordCaptchaServiceImpl.class,
                "REDIS_SECOND_CAPTCHA_KEY");
    }

    /** 清理本用例写入的缓存键，避免静态本地缓存跨用例泄漏。 */
    @AfterEach
    void tearDown() {
        for (String key : createdKeys) {
            cache().delete(key);
        }
        createdKeys.clear();
    }

    /** 生成验证码必须返回可解码图片、非空 token，并写入与返回密钥一致的缓存值。 */
    @Test
    void getReturnsDecodableImageAndStoresCode() throws Exception {
        ResponseModel response = captchaService.get(new CaptchaVO());

        assertThat(response.isSuccess()).isTrue();
        CaptchaVO data = (CaptchaVO) response.getRepData();
        assertThat(data.getToken()).isNotBlank();
        assertThat(data.getOriginalImageBase64()).isNotBlank();
        BufferedImage image = decode(data.getOriginalImageBase64());
        assertThat(image.getWidth()).isEqualTo(120);
        assertThat(image.getHeight()).isEqualTo(40);

        String codeKey = captchaKey(captchaKeyFormat, data.getToken());
        createdKeys.add(codeKey);
        String codeValue = cache().get(codeKey);
        assertThat(codeValue).as("生成结果必须把验证码值写入缓存").isNotNull();
        String code = codeValue.split(",")[0];
        assertThat(code).hasSize(4);
        assertThat(code).matches("[A-HJ-NP-Z2-9]{4}");
        assertThat(codeValue.split(",")[1]).as("返回的密钥必须与缓存中的密钥一致")
                .isEqualTo(data.getSecretKey());
    }

    /** 校验未知 token 时必须按验证码失效拒绝，不消费任何缓存项。 */
    @Test
    void checkRejectsUnknownToken() {
        CaptchaVO request = new CaptchaVO();
        request.setToken("DUMMY-UNKNOWN-TOKEN");
        request.setPointJson("ABCD");

        ResponseModel response = captchaService.check(request);

        assertThat(response.isSuccess()).isFalse();
        assertThat(response.getRepCode()).isEqualTo(RepCodeEnum.API_CAPTCHA_INVALID.getCode());
    }

    /** 校验正确文字时必须成功、清理一次性验证码键，并写入二次校验凭据。 */
    @Test
    void checkAcceptsCorrectCodeAndConsumesIt() throws Exception {
        CaptchaVO data = issueCaptcha();
        String codeKey = captchaKey(captchaKeyFormat, data.getToken());
        String codeValue = cache().get(codeKey);
        String code = codeValue.split(",")[0];
        String secretKey = codeValue.split(",")[1];

        CaptchaVO request = new CaptchaVO();
        request.setToken(data.getToken());
        request.setPointJson(code);
        request.setBrowserInfo("DUMMY-BROWSER-INFO");
        ResponseModel response = captchaService.check(request);

        assertThat(response.isSuccess()).isTrue();
        CaptchaVO result = (CaptchaVO) response.getRepData();
        assertThat(result.getResult()).isTrue();
        assertThat(result.getBrowserInfo()).as("校验成功后必须清除客户端标记").isNull();
        assertThat(cache().exists(codeKey)).as("验证码只能用一次，校验后必须失效").isFalse();
        String secondKey = captchaKey(secondCaptchaKeyFormat,
                AESUtil.aesEncrypt(data.getToken() + "---" + code, secretKey));
        createdKeys.add(secondKey);
        assertThat(cache().get(secondKey)).as("二次校验凭据必须绑定该 token").isEqualTo(data.getToken());
    }

    /** 校验错误文字时必须拒绝、清理一次性验证码键，且不得写入二次校验凭据。 */
    @Test
    void checkRejectsWrongCodeAndConsumesIt() throws Exception {
        CaptchaVO data = issueCaptcha();
        String codeKey = captchaKey(captchaKeyFormat, data.getToken());
        String code = cache().get(codeKey).split(",")[0];
        String secretKey = cache().get(codeKey).split(",")[1];
        String wrongCode = code.startsWith("A") ? "BBBB" : "AAAA";

        CaptchaVO request = new CaptchaVO();
        request.setToken(data.getToken());
        request.setPointJson(wrongCode);
        ResponseModel response = captchaService.check(request);

        assertThat(response.isSuccess()).isFalse();
        assertThat(response.getRepCode()).isEqualTo(RepCodeEnum.API_CAPTCHA_COORDINATE_ERROR.getCode());
        assertThat(cache().exists(codeKey)).as("校验失败同样必须失效，避免被暴力重试").isFalse();
        String secondKey = captchaKey(secondCaptchaKeyFormat,
                AESUtil.aesEncrypt(data.getToken() + "---" + wrongCode, secretKey));
        assertThat(cache().exists(secondKey)).as("校验失败不得发放二次校验凭据").isFalse();
    }

    /** 缓存中的密钥损坏时必须返回失败响应而不是抛出异常。 */
    @Test
    void checkReportsFailureWhenStoredSecretIsInvalid() {
        CaptchaVO data = issueCaptcha();
        String codeKey = captchaKey(captchaKeyFormat, data.getToken());
        cache().set(codeKey, "ABCD,DUMMY-BAD-KEY", 300L);

        CaptchaVO request = new CaptchaVO();
        request.setToken(data.getToken());
        request.setPointJson("ABCD");
        ResponseModel response = captchaService.check(request);

        assertThat(response.isSuccess()).isFalse();
        assertThat(response.getRepMsg()).as("必须回传可读的失败原因").isNotBlank();
    }

    /** 二次校验必须消费有效凭据并返回成功；凭据只能用一次。 */
    @Test
    void verificationAcceptsIssuedVerificationOnce() throws Exception {
        CaptchaVO data = issueCaptcha();
        String codeKey = captchaKey(captchaKeyFormat, data.getToken());
        String codeValue = cache().get(codeKey);
        String code = codeValue.split(",")[0];
        String secretKey = codeValue.split(",")[1];
        String verification = AESUtil.aesEncrypt(data.getToken() + "---" + code, secretKey);
        String secondKey = captchaKey(secondCaptchaKeyFormat, verification);
        cache().set(secondKey, data.getToken(), 300L);
        createdKeys.add(secondKey);

        CaptchaVO request = new CaptchaVO();
        request.setCaptchaVerification(verification);
        ResponseModel response = captchaService.verification(request);

        assertThat(response.isSuccess()).isTrue();
        assertThat(cache().exists(secondKey)).as("二次校验凭据只能用一次").isFalse();

        ResponseModel repeated = captchaService.verification(request);
        assertThat(repeated.isSuccess()).isFalse();
        assertThat(repeated.getRepCode()).isEqualTo(RepCodeEnum.API_CAPTCHA_INVALID.getCode());
    }

    /** 缺少二次校验参数时必须返回父类的参数错误，不访问缓存。 */
    @Test
    void verificationRejectsMissingVerification() {
        ResponseModel response = captchaService.verification(new CaptchaVO());

        assertThat(response.isSuccess()).isFalse();
        assertThat(response.getRepCode()).isEqualTo(RepCodeEnum.NULL_ERROR.getCode());
    }

    /** 二次校验凭据不存在时必须按验证码失效拒绝。 */
    @Test
    void verificationRejectsUnknownVerification() {
        CaptchaVO request = new CaptchaVO();
        request.setCaptchaVerification("DUMMY-UNKNOWN-VERIFICATION");

        ResponseModel response = captchaService.verification(request);

        assertThat(response.isSuccess()).isFalse();
        assertThat(response.getRepCode()).isEqualTo(RepCodeEnum.API_CAPTCHA_INVALID.getCode());
    }

    /** 销毁钩子只记录日志，不得清理仍在有效期内的缓存项。 */
    @Test
    void destroyKeepsCachedEntries() {
        String key = captchaKey(captchaKeyFormat, "DUMMY-KEEP-TOKEN");
        cache().set(key, "ABCD,DUMMY-KEY", 300L);
        createdKeys.add(key);

        captchaService.destroy(new Properties());

        assertThat(cache().exists(key)).as("销毁钩子不得清理本地缓存中的验证码").isTrue();
    }

    /** 随机文字必须只使用去混淆字符集，并遵守请求长度。 */
    @Test
    void generateRandomTextUsesConfusableFreeAlphabet() {
        assertThat(PictureWordCaptchaServiceImpl.generateRandomText(4)).matches("[A-HJ-NP-Z2-9]{4}");
        assertThat(PictureWordCaptchaServiceImpl.generateRandomText(8)).hasSize(8);
        assertThat(PictureWordCaptchaServiceImpl.generateRandomText(0))
                .as("Hutool 的 randomString 把小于 1 的长度按 1 处理，实现未额外校验")
                .matches("[A-HJ-NP-Z2-9]");
    }

    /** 验证码值与密钥的拼接、拆分必须可逆，颜色范围必须归一化后取值。 */
    @Test
    void privateHelpersComposeAndSplitCodeValue() {
        assertThat((String) ReflectionTestUtils.invokeMethod(captchaService, "getCodeValue", "ABCD", "DUMMY-KEY"))
                .isEqualTo("ABCD,DUMMY-KEY");
        assertThat((String) ReflectionTestUtils.invokeMethod(captchaService, "getCodeByCodeValue", "ABCD,DUMMY-KEY"))
                .isEqualTo("ABCD");
        assertThat((String) ReflectionTestUtils.invokeMethod(captchaService, "getSecretKeyByCodeValue",
                "ABCD,DUMMY-KEY")).isEqualTo("DUMMY-KEY");

        Color ascending = (Color) ReflectionTestUtils.invokeMethod(captchaService, "getRandomColor", 10, 20);
        assertThat(ascending.getRed()).isBetween(10, 19);
        assertThat(ascending.getGreen()).isBetween(10, 19);
        assertThat(ascending.getBlue()).isBetween(10, 19);

        Color descending = (Color) ReflectionTestUtils.invokeMethod(captchaService, "getRandomColor", 20, 10);
        assertThat(descending.getRed()).isBetween(10, 19);
        assertThat(descending.getGreen()).isBetween(10, 19);
        assertThat(descending.getBlue()).isBetween(10, 19);
    }

    /** 频率限制命中时必须原样返回限流响应，且不读取验证码缓存。 */
    @Test
    void checkReturnsLimitResponseWithoutTouchingCache() {
        Object previousHandler = ReflectionTestUtils.getField(captchaService, "limitHandler");
        try {
            FrequencyLimitHandler limitHandler = mock(FrequencyLimitHandler.class);
            when(limitHandler.validateCheck(any(CaptchaVO.class)))
                    .thenReturn(ResponseModel.errorMsg(RepCodeEnum.API_REQ_LIMIT_CHECK_ERROR));
            ReflectionTestUtils.setField(captchaService, "limitHandler", limitHandler);

            CaptchaVO request = new CaptchaVO();
            request.setToken("DUMMY-LIMITED-TOKEN");
            request.setPointJson("ABCD");
            ResponseModel response = captchaService.check(request);

            assertThat(response.getRepCode()).isEqualTo(RepCodeEnum.API_REQ_LIMIT_CHECK_ERROR.getCode());
        } finally {
            ReflectionTestUtils.setField(captchaService, "limitHandler", previousHandler);
        }
    }

    /** 二次校验期间缓存不可用时必须返回失败响应而不是抛出异常。 */
    @Test
    void verificationReportsFailureWhenCacheUnavailable() {
        CaptchaCacheService original = CaptchaServiceFactory.cacheService.put(cacheType,
                new FailingCaptchaCacheService());
        try {
            CaptchaVO request = new CaptchaVO();
            request.setCaptchaVerification("DUMMY-VERIFICATION");

            ResponseModel response = captchaService.verification(request);

            assertThat(response.isSuccess()).isFalse();
            assertThat(response.getRepMsg()).as("必须回传缓存故障原因，便于定位").contains(CACHE_FAILURE_MESSAGE);
        } finally {
            CaptchaServiceFactory.cacheService.put(cacheType, original);
        }
    }

    /**
     * 生成一次验证码并登记其缓存键。
     *
     * @return 生成结果中的验证码数据
     */
    private CaptchaVO issueCaptcha() {
        ResponseModel response = captchaService.get(new CaptchaVO());
        assertThat(response.isSuccess()).isTrue();
        CaptchaVO data = (CaptchaVO) response.getRepData();
        createdKeys.add(captchaKey(captchaKeyFormat, data.getToken()));
        return data;
    }

    /**
     * 取得当前缓存类型对应的真实缓存服务。
     *
     * @return aj-captcha 缓存服务
     */
    private CaptchaCacheService cache() {
        return CaptchaServiceFactory.getCache(cacheType);
    }

    /**
     * 按实现使用的键格式拼接缓存键。
     *
     * @param format 键格式
     * @param value 键值
     * @return 缓存键
     */
    private static String captchaKey(String format, String value) {
        return String.format(format, value);
    }

    /**
     * 解码 Base64 图片。
     *
     * @param base64 图片内容
     * @return 解码后的图片
     * @throws Exception 解码失败时抛出
     */
    private static BufferedImage decode(String base64) throws Exception {
        return ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(base64)));
    }

    /**
     * 缓存故障替身：所有访问都抛出可识别异常，用于验证调用方对缓存不可用的降级契约。
     *
     * @author shady2713
     */
    private static class FailingCaptchaCacheService implements CaptchaCacheService {

        /** 写入缓存时抛出，模拟缓存后端不可用。 */
        @Override
        public void set(String key, String value, long expiresInSeconds) {
            throw new IllegalStateException(CACHE_FAILURE_MESSAGE);
        }

        /** 判断缓存项存在时抛出，模拟缓存后端不可用。 */
        @Override
        public boolean exists(String key) {
            throw new IllegalStateException(CACHE_FAILURE_MESSAGE);
        }

        /** 删除缓存项时抛出，模拟缓存后端不可用。 */
        @Override
        public void delete(String key) {
            throw new IllegalStateException(CACHE_FAILURE_MESSAGE);
        }

        /** 读取缓存项时抛出，模拟缓存后端不可用。 */
        @Override
        public String get(String key) {
            throw new IllegalStateException(CACHE_FAILURE_MESSAGE);
        }

        /** 返回缓存类型标识，与本地缓存保持一致。 */
        @Override
        public String type() {
            return "local";
        }

    }

}
