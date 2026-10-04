package com.basicframework.module.infra.controller.admin.file.vo.file;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证文件登记请求的对象路径校验边界。
 *
 * <p>路径会直接成为对象存储的 Key：越界路径（父目录、绝对路径、反斜杠、重复分隔符）可能覆盖
 * 其他用户的文件或落到预期目录之外，超长路径则会在数据库写入阶段才失败。这里用真实
 * Bean Validation 实现校验请求，锁定 {@code @AssertTrue} 路径规则与必填、长度约束的分工。</p>
 *
 * @author shady2713
 */
class FileCreateReqVOTest {

    /** 真实校验器工厂，本类独占并负责关闭。 */
    private static ValidatorFactory validatorFactory;
    /** 真实校验器，用于得到与接口入参校验一致的违规集合。 */
    private static Validator validator;

    /** 建立真实校验器，避免用直接调用校验方法代替容器校验。 */
    @BeforeAll
    static void createValidator() {
        validatorFactory = Validation.buildDefaultValidatorFactory();
        validator = validatorFactory.getValidator();
    }

    /** 关闭校验器工厂，释放其持有的资源。 */
    @AfterAll
    static void closeValidator() {
        if (validatorFactory != null) {
            validatorFactory.close();
        }
    }

    /** 受限相对路径必须通过校验，说明规则没有把正常上传路径一并拒绝。 */
    @Test
    void acceptsRestrictedRelativeObjectPath() {
        assertThat(violationMessages(request("profile/2026/01/avatar.png"))).isEmpty();
    }

    /** 空白路径由必填约束拒绝，与路径格式错误给出不同提示。 */
    @Test
    void rejectsBlankPathAsRequiredField() {
        assertThat(violationMessages(request("   "))).contains("文件路径不能为空");
    }

    /** 超过列容量的路径必须在入口处拒绝，不能留到数据库写入阶段失败。 */
    @Test
    void rejectsPathLongerThanColumnCapacity() {
        String oversized = "a".repeat(513);

        assertThat(violationMessages(request(oversized)))
                .as("路径长度上限必须与 infra_file.path 列容量一致")
                .contains("文件路径长度不能超过 512 个字符");
    }

    /** 越界与不规范路径必须全部被拒绝，避免登记出预期目录之外的对象键。 */
    @Test
    void rejectsEscapingAndMalformedObjectPaths() {
        List<String> invalidPaths = List.of(
                "../other-user/avatar.png",
                "profile/../../etc/passwd",
                "profile/./avatar.png",
                "/absolute/avatar.png",
                "\\absolute\\avatar.png",
                "profile//avatar.png",
                "profile\\avatar.png",
                "profile/avatar.png/");

        for (String path : invalidPaths) {
            assertThat(violationMessages(request(path)))
                    .as("路径 %s 必须被拒绝", path)
                    .contains("文件路径不正确");
        }
    }

    /** 构造只替换对象路径、其余字段合法的登记请求。 */
    private static FileCreateReqVO request(String path) {
        FileCreateReqVO request = new FileCreateReqVO();
        request.setPath(path);
        request.setName("avatar.png");
        request.setUrl("https://www.example.com/avatar.png");
        request.setSize(2048L);
        return request;
    }

    /** 收集请求上的校验提示文本，便于按业务提示断言规则归属。 */
    private static Set<String> violationMessages(FileCreateReqVO request) {
        return validator.validate(request).stream()
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.toSet());
    }
}
