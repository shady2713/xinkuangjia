package com.basicframework.framework.mybatis.core.handler;

import com.basicframework.framework.mybatis.core.dataobject.BaseDO;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import org.apache.ibatis.reflection.MetaObject;
import org.apache.ibatis.reflection.SystemMetaObject;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.LocalDateTime;
import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证审计字段自动填充器在插入与更新两个方向上的真实行为。
 *
 * <p>创建/更新时间与创建/更新人是审计链路的唯一来源：填充遗漏会让记录缺少审计信息，
 * 覆盖已有值会把历史创建信息改写成当前操作者，把非基础实体当成审计对象则可能写入无关字段。
 * 这里用真实 MyBatis {@link MetaObject} 与真实 Spring Security 上下文驱动，锁定契约：</p>
 * <ul>
 *   <li>插入时补全为空的时间字段，并保证创建时间与更新时间取同一时刻；已存在的值不得覆盖；</li>
 *   <li>登录用户存在时补全为空的创建人/更新人，未登录时保持为空（后台任务不得伪造操作者）；</li>
 *   <li>更新时只补空的更新时间与更新人，不触碰创建信息；</li>
 *   <li>非 {@link BaseDO} 对象不参与填充，且不得因此失败。</li>
 * </ul>
 *
 * @author shady2713
 */
class DefaultDBFieldHandlerTest {

    /** 受测的填充器。 */
    private final DefaultDBFieldHandler handler = new DefaultDBFieldHandler();

    /** 清理认证上下文，避免登录用户泄漏到其它用例。 */
    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    /** 未登录插入只补时间，创建人与更新人必须保持为空。 */
    @Test
    void insertFillFillsTimesOnlyWithoutLoginUser() {
        SampleDO sample = new SampleDO();

        handler.insertFill(metaObject(sample));

        assertThat(sample.getCreateTime()).as("创建时间必须补全").isNotNull();
        assertThat(sample.getUpdateTime()).as("插入时更新时间必须同时补全").isEqualTo(sample.getCreateTime());
        assertThat(sample.getCreator()).as("未登录不得伪造创建人").isNull();
        assertThat(sample.getUpdater()).as("未登录不得伪造更新人").isNull();
    }

    /**
     * 插入时不得覆盖已有审计值，并保证同一对象上的创建时间与更新时间一致。
     *
     * <p>历史数据迁移或内部调用会显式指定时间，覆盖会让数据丢失原始口径。</p>
     */
    @Test
    void insertFillKeepsExistingValues() {
        LocalDateTime created = LocalDateTime.of(2020, 1, 2, 3, 4, 5);
        LocalDateTime updated = LocalDateTime.of(2021, 6, 7, 8, 9, 10);
        SampleDO sample = new SampleDO();
        sample.setCreateTime(created);
        sample.setUpdateTime(updated);
        sample.setCreator("DUMMY-CREATOR");
        sample.setUpdater("DUMMY-UPDATER");

        handler.insertFill(metaObject(sample));

        assertThat(sample.getCreateTime()).isEqualTo(created);
        assertThat(sample.getUpdateTime()).isEqualTo(updated);
        assertThat(sample.getCreator()).isEqualTo("DUMMY-CREATOR");
        assertThat(sample.getUpdater()).isEqualTo("DUMMY-UPDATER");
    }

    /** 登录用户存在时，为空的创建人与更新人必须补成该用户编号，已有值不得覆盖。 */
    @Test
    void insertFillFillsAuditUserFromAuthentication() {
        authenticate(7L);
        SampleDO empty = new SampleDO();
        SampleDO withCreator = new SampleDO();
        withCreator.setCreator("DUMMY-CREATOR");

        handler.insertFill(metaObject(empty));
        handler.insertFill(metaObject(withCreator));

        assertThat(empty.getCreator()).as("创建人取当前登录用户编号的字符串形式").isEqualTo("7");
        assertThat(empty.getUpdater()).isEqualTo("7");
        assertThat(withCreator.getCreator()).as("已有创建人不得被当前用户覆盖").isEqualTo("DUMMY-CREATOR");
        assertThat(withCreator.getUpdater()).as("更新人为空时仍按当前用户补全").isEqualTo("7");
    }

    /** 更新时只补空的更新时间与更新人，创建信息必须保持不变。 */
    @Test
    void updateFillFillsOnlyModifyFields() {
        authenticate(8L);
        LocalDateTime created = LocalDateTime.of(2019, 3, 4, 5, 6, 7);
        SampleDO sample = new SampleDO();
        sample.setCreateTime(created);
        sample.setCreator("DUMMY-CREATOR");
        sample.clean();

        handler.updateFill(metaObject(sample));

        assertThat(sample.getUpdateTime()).as("更新时间为空时必须补全").isNotNull();
        assertThat(sample.getUpdater()).as("更新人为空时按当前登录用户补全").isEqualTo("8");
        assertThat(sample.getCreateTime()).as("更新不得写入创建时间").isNull();
        assertThat(sample.getCreator()).as("更新不得写入创建人").isNull();
    }

    /** 已有的更新时间与更新人不得被更新填充覆盖，未登录时不得补出更新人。 */
    @Test
    void updateFillKeepsExistingValuesAndIgnoresAbsentLoginUser() {
        LocalDateTime updated = LocalDateTime.of(2022, 8, 9, 10, 11, 12);
        SampleDO sample = new SampleDO();
        sample.setUpdateTime(updated);
        sample.setUpdater("DUMMY-UPDATER");

        handler.updateFill(metaObject(sample));

        assertThat(sample.getUpdateTime()).as("已有更新时间不得被覆盖").isEqualTo(updated);
        assertThat(sample.getUpdater()).isEqualTo("DUMMY-UPDATER");

        SampleDO anonymous = new SampleDO();
        handler.updateFill(metaObject(anonymous));

        assertThat(anonymous.getUpdateTime()).as("未登录时更新时间仍必须补全").isNotNull();
        assertThat(anonymous.getUpdater()).as("未登录时不得补出更新人").isNull();
    }

    /**
     * 插入填充只认基础实体，更新填充按字段名生效。
     *
     * <p>这是两个方向的真实差别：{@code insertFill} 先按 {@link BaseDO} 类型判断，非基础实体完全不参与；
     * 而 {@code updateFill} 由 MyBatis 在 update 语句上调用，入参是各种更新实体（含不继承基础实体的
     * 更新对象），因此它按 {@code updateTime}/{@code updater} 字段名填充。用例按真实行为断言，
     * 避免把"非基础实体一律不动"的假设当成契约。</p>
     */
    @Test
    void insertFillIgnoresNonBaseDOWhileUpdateFillWorksByName() {
        PlainObject plain = new PlainObject();

        handler.insertFill(metaObject(plain));

        assertThat(plain.getName()).isEqualTo("DUMMY-NAME");
        assertThat(plain.getCreateTime()).as("插入填充必须跳过非基础实体").isNull();
        assertThat(plain.getUpdateTime()).isNull();

        handler.updateFill(metaObject(plain));

        assertThat(plain.getUpdateTime()).as("更新填充按字段名补全更新时间").isNotNull();
        assertThat(plain.getUpdater()).as("未登录时不得补出更新人").isNull();
    }

    /** 非基础实体的更新填充同样使用当前登录用户编号。 */
    @Test
    void updateFillFillsUpdaterByNameForNonBaseDO() {
        authenticate(9L);
        PlainObject plain = new PlainObject();

        handler.updateFill(metaObject(plain));

        assertThat(plain.getUpdater()).as("更新人按字段名补成当前登录用户").isEqualTo("9");
        assertThat(plain.getUpdateTime()).isNotNull();
    }

    /** 在真实 Spring Security 上下文中设置登录用户编号。 */
    private static void authenticate(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(loginUser, null, Collections.emptyList()));
        assertThat(SecurityFrameworkUtils.getLoginUserId()).as("夹具必须先真实建立登录身份").isEqualTo(userId);
    }

    /** 用真实 MyBatis 反射包装对象，与 MyBatis Plus 调用填充器时的入口一致。 */
    private static MetaObject metaObject(Object target) {
        return SystemMetaObject.forObject(target);
    }

    /**
     * 审计填充夹具，模拟业务 DO 继承基础实体的方式。
     *
     * @author shady2713
     */
    public static class SampleDO extends BaseDO {

        /** 业务字段，用于确认填充器不触碰业务数据。 */
        private String name;

        /**
         * 获取名称。
         *
         * @return 名称
         */
        public String getName() {
            return name;
        }

        /**
         * 设置名称。
         *
         * @param name 名称
         */
        public void setName(String name) {
            this.name = name;
        }
    }

    /**
     * 非基础实体夹具，用于确认插入填充按类型跳过、更新填充按字段名生效。
     *
     * @author shady2713
     */
    public static class PlainObject {

        /** 业务名称。 */
        private String name = "DUMMY-NAME";
        /** 与基础实体同名的创建时间，用于确认插入填充不会写入非基础实体。 */
        private LocalDateTime createTime;
        /** 与基础实体同名的更新时间，用于确认更新填充按字段名生效。 */
        private LocalDateTime updateTime;
        /** 与基础实体同名的更新人。 */
        private String updater;

        /**
         * 获取名称。
         *
         * @return 名称
         */
        public String getName() {
            return name;
        }

        /**
         * 获取创建时间。
         *
         * @return 创建时间
         */
        public LocalDateTime getCreateTime() {
            return createTime;
        }

        /**
         * 设置创建时间。
         *
         * @param createTime 创建时间
         */
        public void setCreateTime(LocalDateTime createTime) {
            this.createTime = createTime;
        }

        /**
         * 获取更新时间。
         *
         * @return 更新时间
         */
        public LocalDateTime getUpdateTime() {
            return updateTime;
        }

        /**
         * 设置更新时间。
         *
         * @param updateTime 更新时间
         */
        public void setUpdateTime(LocalDateTime updateTime) {
            this.updateTime = updateTime;
        }

        /**
         * 获取更新人。
         *
         * @return 更新人
         */
        public String getUpdater() {
            return updater;
        }

        /**
         * 设置更新人。
         *
         * @param updater 更新人
         */
        public void setUpdater(String updater) {
            this.updater = updater;
        }
    }

}
