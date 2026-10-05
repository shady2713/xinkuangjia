<?xml version="1.0" encoding="UTF-8"?>
<!--
  新增业务模块 POM 模板。
  替换占位符后放到 后端代码/basic-framework-boot/basic-framework-module-[module]/pom.xml。

  占位符：[module]（模块标识，小写）、[Module]（模块标识，帕斯卡）、[entity-title]（业务中文标题）。
  依赖只保留本模板真实消费的 Starter；模板代码不引用 Excel/Job/短信等能力，因此不引入对应依赖。
-->
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <parent>
        <groupId>com.basicframework</groupId>
        <artifactId>basic-framework</artifactId>
        <version>${revision}</version>
    </parent>
    <modelVersion>4.0.0</modelVersion>
    <artifactId>basic-framework-module-[module]</artifactId>
    <packaging>jar</packaging>

    <name>${project.artifactId}</name>
    <description>
        [module] 模块：[entity-title]等本业务域的接口、服务与持久化实现。
        只承载本业务域职责，不向上游 Starter 或其它业务模块反向依赖。
    </description>

    <dependencies>
        <!-- Web 与安全：@RestController、CommonResult、@PreAuthorize/@ss 安全链 -->
        <dependency>
            <groupId>com.basicframework</groupId>
            <artifactId>basic-framework-spring-boot-starter-security</artifactId>
        </dependency>

        <!-- 持久化：BaseMapperX、LambdaQueryWrapperX、分页与逻辑删除 -->
        <dependency>
            <groupId>com.basicframework</groupId>
            <artifactId>basic-framework-spring-boot-starter-mybatis</artifactId>
        </dependency>

        <!-- 请求参数校验：@Valid、@NotNull、@Size 等 Bean Validation 注解 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>

        <!-- 测试：JUnit 5、AssertJ、Mockito、Spring MVC 测试与真实方法级鉴权 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
