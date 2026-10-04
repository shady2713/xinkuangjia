package com.basicframework.framework.swagger.config;

import com.github.xiaoymin.knife4j.annotations.ApiSupport;
import com.github.xiaoymin.knife4j.core.conf.ExtensionsConstants;
import com.github.xiaoymin.knife4j.core.conf.GlobalConstants;
import com.github.xiaoymin.knife4j.spring.configuration.Knife4jProperties;
import com.github.xiaoymin.knife4j.spring.configuration.Knife4jSetting;
import io.swagger.v3.oas.annotations.tags.Tag;
import io.swagger.v3.oas.models.OpenAPI;
import org.junit.jupiter.api.Test;
import org.springdoc.core.properties.SpringDocConfigProperties;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Knife4j 扩展定制器写入增强扩展与标签排序属性的真实契约。
 *
 * <p>该定制器决定在线文档的增强信息与分组标签顺序：扩展写错会让 Knife4j 前端读不到设置或
 * Markdown 文档，标签顺序写错会让接口目录按错误顺序展示。用例用真实 {@link Knife4jProperties}
 * 与真实 OpenAPI 模型驱动，并让包扫描真实扫描本测试类所在包，核对写入的扩展键值与标签属性。</p>
 *
 * <p>包扫描路径使用本用例所在包，因此扫描到的是真实类文件；断言只针对被 {@code ApiSupport}
 * 与 {@code Tag} 标注的探针控制器，不依赖其它类。</p>
 *
 * @author shady2713
 */
class Knife4jOpenApiCustomizerTest {

    /** 包扫描路径，取本用例所在包以复用真实类文件。 */
    private static final String SCAN_PACKAGE = "com.basicframework.framework.swagger.config";
    /** 探针标签名，对应带 Tag 注解的控制器。 */
    private static final String TAG_NAME = "DUMMY-探针标签";
    /** 探针标签名，对应从接口读取 Tag 的控制器。 */
    private static final String INTERFACE_TAG_NAME = "DUMMY-接口标签";

    /** 关闭增强时不得写入任何扩展。 */
    @Test
    void customiseDoesNothingWhenDisabled() {
        Knife4jProperties knife4jProperties = new Knife4jProperties();
        knife4jProperties.setEnable(false);
        OpenAPI openAPI = new OpenAPI();

        new Knife4jOpenApiCustomizer(knife4jProperties, new SpringDocConfigProperties()).customise(openAPI);

        assertThat(openAPI.getExtensions()).isNull();
    }

    /** 开启增强时必须写入设置与 Markdown 文档两项扩展。 */
    @Test
    void customiseWritesSettingAndMarkdownExtensions() {
        Knife4jProperties knife4jProperties = enabledProperties();
        OpenAPI openAPI = new OpenAPI();

        new Knife4jOpenApiCustomizer(knife4jProperties, new SpringDocConfigProperties()).customise(openAPI);

        Map<String, Object> extensions = openAPI.getExtensions();
        assertThat(extensions).containsKey(GlobalConstants.EXTENSION_OPEN_API_NAME);
        @SuppressWarnings("unchecked")
        Map<String, Object> objectMap = (Map<String, Object>) extensions.get(GlobalConstants.EXTENSION_OPEN_API_NAME);
        assertThat(objectMap).containsKeys(GlobalConstants.EXTENSION_OPEN_SETTING_NAME,
                GlobalConstants.EXTENSION_OPEN_MARKDOWN_NAME);
        assertThat(objectMap.get(GlobalConstants.EXTENSION_OPEN_SETTING_NAME)).isSameAs(knife4jProperties.getSetting());
        assertThat(objectMap.get(GlobalConstants.EXTENSION_OPEN_MARKDOWN_NAME)).isEqualTo(Collections.emptyList());
    }

    /** 未配置分组时必须直接返回，不写入任何标签属性。 */
    @Test
    void addOrderExtensionSkipsWhenNoGroupConfigs() {
        OpenAPI openAPI = openApiWithTags();

        new Knife4jOpenApiCustomizer(enabledProperties(), new SpringDocConfigProperties()).customise(openAPI);

        assertThat(openAPI.getTags()).allSatisfy(tag -> assertThat(tag.getExtensions()).isNull());
    }

    /** 分组未声明扫描包时必须直接返回，不写入任何标签属性。 */
    @Test
    void addOrderExtensionSkipsWhenNoPackagesToScan() {
        SpringDocConfigProperties configProperties = new SpringDocConfigProperties();
        configProperties.setGroupConfigs(Collections.singleton(new SpringDocConfigProperties.GroupConfig()));
        OpenAPI openAPI = openApiWithTags();

        new Knife4jOpenApiCustomizer(enabledProperties(), configProperties).customise(openAPI);

        assertThat(openAPI.getTags()).allSatisfy(tag -> assertThat(tag.getExtensions()).isNull());
    }

    /** 扫描到带 Tag 注解的控制器时，同名标签必须写入 ApiSupport 声明的顺序。 */
    @Test
    void addOrderExtensionWritesOrderForTaggedController() {
        SpringDocConfigProperties configProperties = configPropertiesFor(SCAN_PACKAGE);
        OpenAPI openAPI = openApiWithTags();

        new Knife4jOpenApiCustomizer(enabledProperties(), configProperties).customise(openAPI);

        assertThat(openAPI.getTags()).filteredOn(tag -> TAG_NAME.equals(tag.getName()))
                .singleElement()
                .satisfies(tag -> assertThat(tag.getExtensions())
                        .containsEntry(ExtensionsConstants.EXTENSION_ORDER, 7));
        assertThat(openAPI.getTags()).filteredOn(tag -> INTERFACE_TAG_NAME.equals(tag.getName()))
                .singleElement()
                .satisfies(tag -> assertThat(tag.getExtensions())
                        .as("类上没有 Tag 时必须回退到接口上的 Tag").containsEntry(ExtensionsConstants.EXTENSION_ORDER, 9));
    }

    /** OpenAPI 中没有对应标签时不得凭空新增标签或写入属性。 */
    @Test
    void addOrderExtensionIgnoresTagsNotDeclaredInOpenApi() {
        SpringDocConfigProperties configProperties = configPropertiesFor(SCAN_PACKAGE);
        OpenAPI openAPI = new OpenAPI();

        new Knife4jOpenApiCustomizer(enabledProperties(), configProperties).customise(openAPI);

        assertThat(openAPI.getTags()).as("标签集合由扫描结果与文档模型共同决定，缺失时保持为空").isNull();
        assertThat(openAPI.getExtensions()).containsKey(GlobalConstants.EXTENSION_OPEN_API_NAME);
    }

    /** 扫描包不存在时返回空集合，不写入任何标签属性也不抛错。 */
    @Test
    void addOrderExtensionHandlesEmptyScanResult() {
        SpringDocConfigProperties configProperties = configPropertiesFor("com.basicframework.framework.swagger.absent");
        OpenAPI openAPI = openApiWithTags();

        new Knife4jOpenApiCustomizer(enabledProperties(), configProperties).customise(openAPI);

        assertThat(openAPI.getTags()).allSatisfy(tag -> assertThat(tag.getExtensions()).isNull());
    }

    /** 构造开启增强的 Knife4j 配置。 */
    private static Knife4jProperties enabledProperties() {
        Knife4jProperties properties = new Knife4jProperties();
        properties.setEnable(true);
        properties.setSetting(new Knife4jSetting());
        properties.setDocuments(Collections.emptyList());
        return properties;
    }

    /** 构造含两个待排序标签的文档模型。 */
    private static OpenAPI openApiWithTags() {
        OpenAPI openAPI = new OpenAPI();
        openAPI.addTagsItem(new io.swagger.v3.oas.models.tags.Tag().name(TAG_NAME));
        openAPI.addTagsItem(new io.swagger.v3.oas.models.tags.Tag().name(INTERFACE_TAG_NAME));
        return openAPI;
    }

    /** 构造声明扫描包的 Springdoc 分组配置。 */
    private static SpringDocConfigProperties configPropertiesFor(String packageToScan) {
        SpringDocConfigProperties configProperties = new SpringDocConfigProperties();
        SpringDocConfigProperties.GroupConfig groupConfig = new SpringDocConfigProperties.GroupConfig();
        groupConfig.setPackagesToScan(List.of(packageToScan));
        configProperties.setGroupConfigs(Collections.singleton(groupConfig));
        return configProperties;
    }

    /**
     * 带类级 Tag 与 ApiSupport 顺序的探针控制器。
     *
     * @author shady2713
     */
    @RestController
    @ApiSupport(order = 7)
    @Tag(name = TAG_NAME)
    public static class TaggedProbeController {
    }

    /**
     * 只带 ApiSupport 顺序、无 Tag 的探针控制器，用于验证标签缺失时跳过。
     *
     * @author shady2713
     */
    @RestController
    @ApiSupport(order = 11)
    public static class UntaggedProbeController {
    }

    /**
     * 在接口上声明 Tag 的探针接口。
     *
     * @author shady2713
     */
    @Tag(name = INTERFACE_TAG_NAME)
    public interface TaggedProbeApi {
    }

    /**
     * 类上无 Tag、从接口继承 Tag 的探针控制器。
     *
     * @author shady2713
     */
    @RestController
    @ApiSupport(order = 9)
    public static class InterfaceTaggedProbeController implements TaggedProbeApi {
    }

}
