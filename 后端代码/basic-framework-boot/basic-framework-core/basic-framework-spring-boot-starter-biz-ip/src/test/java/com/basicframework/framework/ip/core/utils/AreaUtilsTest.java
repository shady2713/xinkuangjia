package com.basicframework.framework.ip.core.utils;

import com.basicframework.framework.ip.core.Area;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证区域数据的静态加载与父子索引关系。
 *
 * @author 李杰
 */
class AreaUtilsTest {

    /**
     * 验证全局根节点和中国节点能够从静态索引读取。
     */
    @Test
    void shouldLoadRootAndChinaAreas() {
        Area global = AreaUtils.getArea(Area.ID_GLOBAL);
        Area china = AreaUtils.getArea(Area.ID_CHINA);

        assertThat(global).isNotNull();
        assertThat(global.getName()).isEqualTo("全球");
        assertThat(china).isNotNull();
        assertThat(china.getParent()).isSameAs(global);
        assertThat(global.getChildren()).contains(china);
    }

    /**
     * 验证未知区域编号仍返回空结果。
     */
    @Test
    void shouldReturnNullForUnknownArea() {
        assertThat(AreaUtils.getArea(Integer.MIN_VALUE)).isNull();
    }
}
