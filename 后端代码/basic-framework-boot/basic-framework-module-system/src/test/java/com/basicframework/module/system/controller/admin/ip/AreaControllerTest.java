package com.basicframework.module.system.controller.admin.ip;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.ip.core.Area;
import com.basicframework.framework.ip.core.utils.AreaUtils;
import com.basicframework.framework.ip.core.utils.IPUtils;
import com.basicframework.module.system.controller.admin.ip.vo.AreaNodeRespVO;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证地区接口的地区树与 IP 归属地解析行为。
 *
 * <p>地区树为前端级联选择提供全量节点，必须来自随包区域数据且结构与父节点一致，不能因为
 * 转换丢失层级。IP 归属地接口把地址解析成可读地名：命中区域时返回“省 市”形式，随包数据
 * 中没有对应区域的地址必须回退为“未知”，而不是返回 null 或把编号当名称。</p>
 *
 * @author shady2713
 */
class AreaControllerTest {

    /** 被测 Controller，依赖的均为静态区域与 IP 工具。 */
    private final AreaController controller = new AreaController();

    /** 地区树必须返回中国节点下的全部子节点，并保留层级关系。 */
    @Test
    void areaTreeReturnsAllChildrenOfChina() {
        CommonResult<List<AreaNodeRespVO>> result = controller.getAreaTree();

        assertThat(result.getCode()).isZero();
        List<AreaNodeRespVO> nodes = result.getData();
        assertThat(nodes).as("与随包区域数据一致")
                .hasSameSizeAs(AreaUtils.getArea(Area.ID_CHINA).getChildren());
        assertThat(nodes).extracting(AreaNodeRespVO::getId)
                .containsExactlyElementsOf(AreaUtils.getArea(Area.ID_CHINA).getChildren().stream()
                        .map(Area::getId).toList());
        AreaNodeRespVO first = nodes.get(0);
        assertThat(first.getId()).isEqualTo(110000);
        assertThat(first.getName()).isEqualTo("北京市");
        assertThat(first.getChildren()).as("省市节点必须保留下级区划").isNotEmpty();
    }

    /** 命中区域的 IP 必须解析为“省 市”形式的地名。 */
    @Test
    void areaByIpResolvesFormattedRegionName() {
        assertThat(controller.getAreaByIp("114.114.114.114").getData()).isEqualTo("江苏省 南京市");
        assertThat(controller.getAreaByIp("220.181.38.148").getData()).isEqualTo("北京市 北京市");
    }

    /** 随包数据中没有对应区域的地址必须回退为“未知”。 */
    @Test
    void areaByIpFallsBackToUnknownForUnmappedRegion() {
        // 该地址在随包 xdb 中映射到区域编号 710000，而 area.csv 未收录该编号，因此解析不到区域。
        assertThat(IPUtils.getArea("123.240.200.81")).as("前置条件：该地址没有对应区域").isNull();

        assertThat(controller.getAreaByIp("123.240.200.81").getData()).isEqualTo("未知");
    }
}
