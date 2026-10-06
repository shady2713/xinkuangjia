package com.basicframework.framework.security.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.Collections;
import java.util.List;

/**
 * 安全框架的配置属性类
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-security/src/main/java/
 * 上游文件续：cn/iocoder/yudao/framework/security/config/SecurityProperties.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：命名空间/模块名/类名前缀适配、配置前缀 yudao.*→basic-framework.*；改写/新增 4 行，移除或改写上游 4 行；import 新增 2 行、移除 2 行；补充注释 2 行。
 */
@ConfigurationProperties(prefix = "basic-framework.security")
@Validated
@Data
public class SecurityProperties {

    /**
     * HTTP 请求时，访问令牌的请求 Header
     */
    @NotEmpty(message = "Token Header 不能为空")
    private String tokenHeader = "Authorization";
    /**
     * HTTP 请求时，访问令牌的请求参数
     *
     * 初始目的：解决 WebSocket 无法通过 header 传参，只能通过 token 参数拼接
     */
    @NotEmpty(message = "Token Parameter 不能为空")
    private String tokenParameter = "token";

    /**
     * mock 模式的开关
     */
    @NotNull(message = "mock 模式的开关不能为空")
    private Boolean mockEnable = false;
    /**
     * mock 模式的密钥
     * 一定要配置密钥，保证安全性
     */
    @NotEmpty(message = "mock 模式的密钥不能为空") // 仅当 mockEnable 为 true 时需要配置，请使用高强度密钥
    private String mockSecret = "PLEASE_CHANGE_THIS_SECRET";

    /**
     * 免登录的 URL 列表
     */
    private List<String> permitAllUrls = Collections.emptyList();

    /**
     * PasswordEncoder 加密复杂度，越高开销越大
     */
    private Integer passwordEncoderLength = 10;
}
