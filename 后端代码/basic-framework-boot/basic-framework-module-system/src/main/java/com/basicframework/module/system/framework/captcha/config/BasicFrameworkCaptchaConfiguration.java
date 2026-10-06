package com.basicframework.module.system.framework.captcha.config;

import com.basicframework.module.system.framework.captcha.core.RedisCaptchaServiceImpl;
import com.anji.captcha.config.AjCaptchaAutoConfiguration;
import com.anji.captcha.properties.AjCaptchaProperties;
import com.anji.captcha.service.CaptchaCacheService;
import com.anji.captcha.service.impl.CaptchaServiceFactory;
import com.anji.captcha.util.ImageUtils;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.io.InputStream;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 验证码的配置类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Configuration(proxyBeanMethods = false)
@ImportAutoConfiguration(AjCaptchaAutoConfiguration.class) // 目的：解决 aj-captcha 针对 SpringBoot 3.X 自动配置不生效的问题
public class BasicFrameworkCaptchaConfiguration {

    /**
     * 完成 captchaCacheService 对应的业务处理。
     *
     * @param config 配置参数
     * @param stringRedisTemplate stringRedis模板参数
     * @return 方法处理结果
     */
    @Bean(name = "AjCaptchaCacheService")
    @Primary
    public CaptchaCacheService captchaCacheService(AjCaptchaProperties config,
                                                   StringRedisTemplate stringRedisTemplate) {
        CaptchaCacheService captchaCacheService = CaptchaServiceFactory.getCache(config.getCacheType().name());
        if (captchaCacheService instanceof RedisCaptchaServiceImpl) {
            ((RedisCaptchaServiceImpl) captchaCacheService).setStringRedisTemplate(stringRedisTemplate);
        }
        return captchaCacheService;
    }

    /**
     * 完成 captchaJigsawImageCacheLoader 对应的业务处理。
     *
     * @return 方法处理结果
     */
    @Bean
    public SmartInitializingSingleton captchaJigsawImageCacheLoader() {
        return () -> {
            try {
                Map<String, String> originalImages = loadCaptchaImages("classpath*:captcha/jigsaw/original/*.png");
                if (!originalImages.isEmpty()) {
                    // 使用和 aj-captcha 默认图库一致的文件名覆盖缓存，避免随机命中依赖包中的旧素材。
                    ImageUtils.cacheBootImage(originalImages, Map.of(), Map.of());
                }
            } catch (Exception exception) {
                // 验证码背景属于登录关键路径，加载失败时直接阻止启动，避免回退到依赖包默认素材。
                throw new IllegalStateException("登录滑块验证码自定义背景加载失败", exception);
            }
        };
    }

    /**
     * 加载CaptchaImages。
     */
    private Map<String, String> loadCaptchaImages(String locationPattern) throws Exception {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        Resource[] resources = resolver.getResources(locationPattern);
        Map<String, String> imageMap = new LinkedHashMap<>(resources.length);
        for (Resource resource : resources) {
            String filename = resource.getFilename();
            if (filename == null || !resource.isReadable()) {
                continue;
            }
            try (InputStream inputStream = resource.getInputStream()) {
                // aj-captcha 的图片缓存以 Base64 字符串保存，这里统一转换后写入启动缓存。
                imageMap.put(filename, Base64.getEncoder().encodeToString(inputStream.readAllBytes()));
            }
        }
        return imageMap;
    }

}
