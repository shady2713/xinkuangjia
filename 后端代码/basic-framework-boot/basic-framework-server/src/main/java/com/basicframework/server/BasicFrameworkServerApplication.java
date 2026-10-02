package com.basicframework.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Basic Framework 后端服务启动入口，负责加载 server 与 module 包下的 Spring 组件。
 *
 * @author 李杰
 */
@SuppressWarnings("SpringComponentScan") // 忽略 IDEA 无法识别 ${basic-framework.info.base-package}
@SpringBootApplication(scanBasePackages = {"${basic-framework.info.base-package}.server", "${basic-framework.info.base-package}.module"})
public class BasicFrameworkServerApplication {

    /**
     * 启动 Spring Boot 应用。
     *
     * @param args 命令行启动参数
     */
    public static void main(String[] args) {
        SpringApplication.run(BasicFrameworkServerApplication.class, args);
    }

}
