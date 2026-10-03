package com.basicframework.module.system.enums.oauth2;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.Modifier;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 机器主体令牌约定测试。
 *
 * <p>该类只持有常量与一个空私有构造，JaCoCo 不为其产出方法计数器，
 * 覆盖率门禁按纯声明处理。防实例化守卫与哨兵值的列约束因此由本测试守护，
 * 而不是靠放宽覆盖率判据掩盖。</p>
 *
 * @author 李杰
 */
class OAuth2MachineTokenTest {

    /** refresh_token 列长度上限，哨兵值必须能写入 NOT NULL 列。 */
    private static final int REFRESH_TOKEN_COLUMN_LIMIT = 32;

    /** 真实刷新令牌是 IdUtil.fastSimpleUUID() 生成的 32 位十六进制串。 */
    private static final Pattern UUID_HEX = Pattern.compile("^[0-9a-f]{32}$");

    /**
     * 验证防实例化守卫同时依赖 final 类型与私有构造，缺一不可。
     *
     * <p>只断言私有构造会被 final 缺失绕过，只断言 final 会被非私有构造绕过；
     * 两者都在这里锁定。反射 setAccessible 属于主动逃逸，不属于本契约。</p>
     *
     * @throws Exception 反射读取构造器失败时抛出
     */
    @Test
    @DisplayName("防实例化守卫是真实的私有构造，外层类型不可继承")
    void classIsNotInstantiable() throws Exception {
        // 类型必须 final，否则子类可以绕过私有构造暴露新的实例化路径。
        assertThat(Modifier.isFinal(OAuth2MachineToken.class.getModifiers())).isTrue();
        Constructor<?>[] constructors = OAuth2MachineToken.class.getDeclaredConstructors();
        assertThat(constructors).hasSize(1);
        Constructor<?> constructor = constructors[0];
        assertThat(Modifier.isPrivate(constructor.getModifiers())).isTrue();
        // 不覆写可访问性时实例化必须被拒绝；setAccessible 属于反射逃逸，不在契约范围内。
        assertThatThrownBy(constructor::newInstance).isInstanceOf(IllegalAccessException.class);
    }

    /**
     * 验证哨兵值同时满足数据库列约束与刷新入口的拒绝条件。
     *
     * <p>refresh_token 列是 NOT NULL 且长度上限 32，写不下会直接落库失败；
     * 值若长得像真实刷新令牌，续期入口会误判为可用凭据。两条约束都要锁住。</p>
     */
    @Test
    @DisplayName("哨兵值能写入 refresh_token 列，且不会被误认为可用刷新令牌")
    void sentinelSatisfiesColumnAndRejectionContract() {
        String sentinel = OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN;

        // 写列约束：NOT NULL 列必须放得下，哨兵不是 null。
        assertThat(sentinel).isNotBlank();
        assertThat(sentinel.length()).isLessThanOrEqualTo(REFRESH_TOKEN_COLUMN_LIMIT);
        // 识别约束：不是 32 位十六进制，刷新入口不会把它当成真实刷新令牌命中。
        assertThat(UUID_HEX.matcher(sentinel).matches()).isFalse();
    }
}
