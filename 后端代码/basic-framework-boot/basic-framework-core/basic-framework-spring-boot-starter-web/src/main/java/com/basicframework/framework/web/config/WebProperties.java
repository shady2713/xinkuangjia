package com.basicframework.framework.web.config;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * Web 自动配置参数
 * <p>
 * 统一管理 API 前缀、Controller 包扫描策略、UI 配置与跨域白名单。
 *
 * @author 李杰
 */
@ConfigurationProperties(prefix = "basic-framework.web")
@Validated
@Data
public class WebProperties {

    /**
     * app 端 API 配置（默认前缀 /app-api）
     */
    @NotNull(message = "APP API 不能为空")
    private Api appApi = new Api("/app-api", "**.controller.app.**");
    /**
     * 管理后台 API 配置（默认前缀 /admin-api）
     */
    @NotNull(message = "Admin API 不能为空")
    private Api adminApi = new Api("/admin-api", "**.controller.admin.**");

    /**
     * 后台管理界面地址
     */
    @NotNull(message = "Admin UI 不能为空")
    private Ui adminUi;

    /**
     * CORS 允许的源地址列表，支持 Ant 风格通配符
     * 生产环境应配置为具体域名
     */
    private List<String> corsAllowedOrigins = List.of("*");

    /**
     * API 路径映射配置
     * @author 李杰
     */
    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    @Valid
    public static class Api {

        /**
         * API 前缀，实现所有 Controller 提供的 RESTFul API 的统一前缀
         *
         *
         * 意义：通过该前缀，避免 Swagger、Actuator 意外通过 Nginx 暴露出来给外部，带来安全性问题
         *      这样，Nginx 只需要配置转发到 /api/* 的所有接口即可。
         *
         * @see BasicFrameworkWebAutoConfiguration#configurePathMatch(PathMatchConfigurer)
         */
        @NotEmpty(message = "API 前缀不能为空")
        private String prefix;

        /**
         * Controller 所在包的 Ant 路径规则
         *
         * 主要目的是，给该 Controller 设置指定的 {@link #prefix}
         */
        @NotEmpty(message = "Controller 所在包不能为空")
        private String controller;

    }

    /**
     * 管理后台 UI 配置
     * @author 李杰
     */
    @Data
    @Valid
    public static class Ui {

        /**
         * 访问地址
         */
        private String url;

    }

}
