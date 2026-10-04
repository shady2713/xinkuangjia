package com.basicframework.framework.common.pojo;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证排序字段名与排序方向的合法性判定契约。
 *
 * <p>这两个静态判定是排序入参进入 SQL 之前的白名单闸门：字段名会被拼接进
 * {@code ORDER BY}（{@code MyBatisUtils.validateSortingField}），一旦放行引号、分号、
 * 空格或点号，就等于把注入片段交给数据库；长度上限则保证超长字段名在到达数据库前失败。
 * 因此本用例的重点是负对照：常见注入片段与结构非法字符必须全部被拒。</p>
 *
 * <p>第二层是注解校验：{@code @Pattern} 决定接口入参在进入业务逻辑前能否被拦下。
 * 注解对 {@code null} 放行（未填写不是格式错误），而静态判定对 {@code null} 返回
 * {@code false}（没有字段名就无法排序），两者口径不同，本用例分别锁定。</p>
 *
 * @author shady2713
 */
class SortingFieldTest {

    /** 排序字段名的允许长度上限，与列与正则声明一致。 */
    private static final int MAX_FIELD_LENGTH = 64;

    /** 真实校验器工厂，本类独占并负责关闭。 */
    private static ValidatorFactory validatorFactory;
    /** 与接口入参一致的校验器。 */
    private static Validator validator;

    /** 建立真实 Bean Validation 校验器，使注解路径与生产接口一致。 */
    @BeforeAll
    static void createValidator() {
        validatorFactory = Validation.buildDefaultValidatorFactory();
        validator = validatorFactory.getValidator();
    }

    /** 关闭校验器工厂，释放其持有的资源。 */
    @AfterAll
    static void closeValidator() {
        validatorFactory.close();
    }

    /** 字母、数字与下划线组成、且不超过 64 位的字段名必须放行。 */
    @Test
    void validFieldNamesAreAccepted() {
        assertThat(SortingField.isValidField("id")).isTrue();
        assertThat(SortingField.isValidField("create_time")).isTrue();
        assertThat(SortingField.isValidField("A1_b2")).isTrue();
        assertThat(SortingField.isValidField("_")).as("单下划线在允许字符集内").isTrue();
        assertThat(SortingField.isValidField("a".repeat(MAX_FIELD_LENGTH)))
                .as("恰好 64 位是可用的上边界").isTrue();
    }

    /**
     * 空值、超长与含结构字符的字段名必须被拒，其中注入片段是核心负对照。
     *
     * <p>下划线大小写之外的字符（点号、空格、引号、分号、连字符、中文）都会改变
     * 拼接出的 SQL 语义，必须在这里失败，而不是留到数据库报语法错误。</p>
     */
    @Test
    void invalidFieldNamesAreRejected() {
        assertThat(SortingField.isValidField(null)).as("缺少字段名无法排序").isFalse();
        assertThat(SortingField.isValidField("")).isFalse();
        assertThat(SortingField.isValidField(" ")).isFalse();
        assertThat(SortingField.isValidField("a".repeat(MAX_FIELD_LENGTH + 1)))
                .as("超过 64 位必须拒绝").isFalse();

        assertThat(SortingField.isValidField("a b")).as("空格必须拒绝").isFalse();
        assertThat(SortingField.isValidField("a-b")).as("连字符必须拒绝").isFalse();
        assertThat(SortingField.isValidField("t.name")).as("点号必须拒绝").isFalse();
        assertThat(SortingField.isValidField("name'")).as("单引号必须拒绝").isFalse();
        assertThat(SortingField.isValidField("id;drop table system_users"))
                .as("分号注入片段必须拒绝").isFalse();
        assertThat(SortingField.isValidField("id--")).as("注释符必须拒绝").isFalse();
        assertThat(SortingField.isValidField("id) or (1=1")).as("括号与逻辑片段必须拒绝").isFalse();
        assertThat(SortingField.isValidField("排序")).as("非 ASCII 字段名必须拒绝").isFalse();
    }

    /** 排序方向只接受 asc 与 desc 两个词，且大小写不敏感。 */
    @Test
    void validOrdersAreAcceptedIgnoringCase() {
        assertThat(SortingField.isValidOrder("asc")).isTrue();
        assertThat(SortingField.isValidOrder("ASC")).isTrue();
        assertThat(SortingField.isValidOrder("Asc")).isTrue();
        assertThat(SortingField.isValidOrder("desc")).isTrue();
        assertThat(SortingField.isValidOrder("DESC")).isTrue();
        assertThat(SortingField.isValidOrder("Desc")).isTrue();
    }

    /** 缺失、空串、多余空白与其它方向词必须被拒，避免拼出非法 ORDER BY。 */
    @Test
    void invalidOrdersAreRejected() {
        assertThat(SortingField.isValidOrder(null)).as("缺少方向无法排序").isFalse();
        assertThat(SortingField.isValidOrder("")).isFalse();
        assertThat(SortingField.isValidOrder(" ")).isFalse();
        assertThat(SortingField.isValidOrder("ascending")).isFalse();
        assertThat(SortingField.isValidOrder("asc ")).as("尾随空白必须拒绝").isFalse();
        assertThat(SortingField.isValidOrder(" asc")).as("前导空白必须拒绝").isFalse();
        assertThat(SortingField.isValidOrder("asc;drop")).isFalse();
        assertThat(SortingField.isValidOrder("1")).isFalse();
    }

    /**
     * 方向常量必须与判定口径一致，避免常量改名后判定与拼接两处漂移。
     *
     * <p>下游 {@code MyBatisUtils} 用这两个常量决定升序/降序，常量取值一旦变化，
     * 判定仍然通过但排序方向会静默颠倒。</p>
     */
    @Test
    void orderConstantsMatchValidation() {
        assertThat(SortingField.ORDER_ASC).isEqualTo("asc");
        assertThat(SortingField.ORDER_DESC).isEqualTo("desc");
        assertThat(SortingField.isValidOrder(SortingField.ORDER_ASC)).isTrue();
        assertThat(SortingField.isValidOrder(SortingField.ORDER_DESC)).isTrue();
    }

    /**
     * 注解路径必须给出与静态判定一致的失败结论，并保留前端可展示的提示文案。
     *
     * <p>{@code @Pattern} 只约束“填了的内容”，所以字段名或方向为 {@code null} 时注解不报错，
     * 由静态判定在真正排序时拒绝；这里同时锁定两种口径，避免误以为注解已覆盖空值。</p>
     */
    @Test
    void annotationPathRejectsMalformedValuesWithDeclaredMessages() {
        assertThat(violations(sortingField("id", "asc"))).isEmpty();
        assertThat(violations(sortingField("create_time", "desc"))).isEmpty();
        assertThat(violations(sortingField(null, null)))
                .as("未填写不是格式错误，注解对 null 放行").isEmpty();

        assertThat(messages(sortingField("id;drop", "asc")))
                .containsExactly("排序字段名不合法");
        assertThat(messages(sortingField("a".repeat(MAX_FIELD_LENGTH + 1), "asc")))
                .containsExactly("排序字段名不合法");
        assertThat(messages(sortingField("id", "up")))
                .containsExactly("排序方向只能为 asc 或 desc");
        assertThat(messages(sortingField("id", "asc ")))
                .as("方向两侧空白不是合法取值").containsExactly("排序方向只能为 asc 或 desc");
    }

    /**
     * 锁定注解与静态判定对方向大小写的真实差异。
     *
     * <p>{@code @Pattern} 的正则不含大小写标志，只接受小写；静态判定用
     * {@code equalsIgnoreCase}，大小写都能通过。差异本身是既有实现口径：
     * 接口入参只会收到小写方向，而程序化调用方若直接拼装 {@code "ASC"}，
     * 会绕过注解校验并进入下游拼接逻辑，因此这里把两侧行为分别固定下来。</p>
     */
    @Test
    void orderCaseIsHandledDifferentlyByAnnotationAndStaticCheck() {
        assertThat(messages(sortingField("id", "DESC")))
                .as("注解只接受小写方向").containsExactly("排序方向只能为 asc 或 desc");
        assertThat(SortingField.isValidOrder("DESC"))
                .as("静态判定对大小写不敏感").isTrue();
        assertThat(SortingField.isValidField("id")).isTrue();
        assertThat(violations(sortingField("id", "DESC")))
                .as("同一取值在两层判定下结论不同").isNotEmpty();
    }

    /** 构造仅含排序字段与方向的待校验对象。 */
    private static SortingField sortingField(String field, String order) {
        SortingField sortingField = new SortingField();
        sortingField.setField(field);
        sortingField.setOrder(order);
        return sortingField;
    }

    /** 校验对象并返回全部约束违规。 */
    private static Set<ConstraintViolation<SortingField>> violations(SortingField target) {
        return validator.validate(target);
    }

    /** 校验对象并返回全部违规提示文案，用于锁定前端展示口径。 */
    private static Set<String> messages(SortingField target) {
        return violations(target).stream()
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.toSet());
    }
}
