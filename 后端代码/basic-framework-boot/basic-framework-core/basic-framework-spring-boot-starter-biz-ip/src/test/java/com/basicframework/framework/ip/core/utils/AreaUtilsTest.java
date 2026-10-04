package com.basicframework.framework.ip.core.utils;

import com.basicframework.framework.ip.core.Area;
import com.basicframework.framework.ip.core.enums.AreaTypeEnum;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证区域数据的静态加载、路径解析、展示格式化与按类型回溯契约。
 *
 * <p>区域数据来自模块内置的 {@code area.csv}，由静态初始化一次性建立父子索引：索引错位会让
 * 归属地展示与实际地址不符，路径解析失败会让导入的地区列全部为空，父级回溯错误会把统计挂到
 * 别的省市。因此用例按真实数据断言可观察结果，覆盖国家、省市、区县三级与全球根节点。</p>
 *
 * <p>{@code loadAreas} 中捕获 {@link java.io.IOException} 的分支（第 59–60 行）不可达：
 * 唯一的受检异常来源是 try-with-resources 对 {@link java.io.BufferedReader} 的 {@code close()}，
 * 而读取失败只会抛出 Hutool 的非受检 {@code IORuntimeException}；若类路径上缺少 {@code area.csv}，
 * 该静态字段初始化本身就会失败，本用例的所有断言都不可能执行到。因此该分支不写用例，
 * 只在此记录不可达依据。</p>
 *
 * @author 李杰
 */
class AreaUtilsTest {

    /** 北京市省级节点编号。 */
    private static final Integer BEIJING_PROVINCE_ID = 110000;
    /** 北京市市级节点编号。 */
    private static final Integer BEIJING_CITY_ID = 110100;
    /** 河南省省级节点编号。 */
    private static final Integer HENAN_PROVINCE_ID = 410000;
    /** 郑州市市级节点编号。 */
    private static final Integer ZHENGZHOU_CITY_ID = 410100;
    /** 郑州市金水区节点编号。 */
    private static final Integer JINSHUI_DISTRICT_ID = 410105;
    /** 美国国家节点编号。 */
    private static final Integer UNITED_STATES_ID = 166;

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

    /** 三级路径必须逐级下钻到区县，同级重名由父级范围限定。 */
    @Test
    void parseAreaResolvesNestedPathAndRootLevelName() {
        Area district = AreaUtils.parseArea("河南省/郑州市/金水区");
        assertThat(district).isNotNull();
        assertThat(district.getId()).isEqualTo(JINSHUI_DISTRICT_ID);
        assertThat(district.getType()).isEqualTo(AreaTypeEnum.DISTRICT.getType());

        Area country = AreaUtils.parseArea("美国");
        assertThat(country).isNotNull();
        assertThat(country.getId()).isEqualTo(UNITED_STATES_ID);
        assertThat(country.getType()).isEqualTo(AreaTypeEnum.COUNTRY.getType());
    }

    /** 路径任一层无法匹配时必须返回 null，不得退回上一层的部分结果。 */
    @Test
    void parseAreaReturnsNullWhenAnySegmentMissing() {
        assertThat(AreaUtils.parseArea("河南省/不存在的城市")).as("子级不存在时不得返回省级节点").isNull();
        assertThat(AreaUtils.parseArea("不存在的国家")).isNull();
        assertThat(AreaUtils.parseArea("")).as("空路径按无法匹配处理").isNull();
    }

    /** 从给定节点出发按"祖先/父级/子级"拼接全部后代路径，顺序与数据定义一致。 */
    @Test
    void getAreaNodePathListBuildsPathForEveryDescendant() {
        Area beijingProvince = AreaUtils.getArea(BEIJING_PROVINCE_ID);
        assertThat(AreaUtils.getAreaNodePathList(List.of(beijingProvince)))
                .as("省级节点展开到市级与全部区县").hasSize(18)
                .startsWith("北京市", "北京市/北京市")
                .contains("北京市/北京市/东城区", "北京市/北京市/延庆区");

        Area beijingCity = AreaUtils.getArea(BEIJING_CITY_ID);
        assertThat(AreaUtils.getAreaNodePathList(List.of(beijingCity)))
                .as("市级节点必须展开到全部区县").hasSize(17)
                .startsWith("北京市")
                .contains("北京市/东城区", "北京市/延庆区");

        Area eastDistrict = AreaUtils.getArea(110101);
        assertThat(AreaUtils.getAreaNodePathList(List.of(eastDistrict)))
                .as("叶子节点只有自身一条路径").containsExactly("东城区");
    }

    /** 从全球根节点出发时必须包含跨国深度路径，证明递归覆盖整棵树。 */
    @Test
    void getAreaNodePathListCoversFullTreeFromGlobalRoot() {
        List<String> paths = AreaUtils.getAreaNodePathList(List.of(AreaUtils.getArea(Area.ID_GLOBAL)));

        assertThat(paths).contains("全球", "全球/中国", "全球/中国/河南省/郑州市/金水区", "全球/美国");
        assertThat(paths).doesNotContainNull();
    }

    /** 空输入与空节点都必须安全跳过，不得产生 null 路径项。 */
    @Test
    void getAreaNodePathListSkipsNullNodeAndEmptyInput() {
        assertThat(AreaUtils.getAreaNodePathList(Collections.emptyList())).isEmpty();
        assertThat(AreaUtils.getAreaNodePathList(Arrays.asList((Area) null))).isEmpty();
    }

    /** 区县展示必须带上省与市，默认以空格分隔且不显示"中国"。 */
    @Test
    void formatUsesDefaultSeparatorAndSkipsChina() {
        assertThat(AreaUtils.format(JINSHUI_DISTRICT_ID)).isEqualTo("河南省 郑州市 金水区");
        assertThat(AreaUtils.format(ZHENGZHOU_CITY_ID)).isEqualTo("河南省 郑州市");
        assertThat(AreaUtils.format(HENAN_PROVINCE_ID)).as("省级节点没有可展示的上级").isEqualTo("河南省");
        assertThat(AreaUtils.format(Area.ID_CHINA)).isEqualTo("中国");
        assertThat(AreaUtils.format(Area.ID_GLOBAL)).isEqualTo("全球");
    }

    /** 分隔符必须按调用方传入的值拼接；境外区域保留国家层级。 */
    @Test
    void formatHonoursCustomSeparatorAndKeepsForeignCountry() {
        assertThat(AreaUtils.format(JINSHUI_DISTRICT_ID, "/")).isEqualTo("河南省/郑州市/金水区");
        assertThat(AreaUtils.format(UNITED_STATES_ID, "-")).as("境外区域保留国家名").isEqualTo("美国");
    }

    /** 未知编号与 null 编号都必须返回 null，不得抛出异常或返回空串。 */
    @Test
    void formatReturnsNullForUnknownId() {
        assertThat(AreaUtils.format(Integer.MIN_VALUE)).isNull();
        assertThat(AreaUtils.format(null)).isNull();
    }

    /** 按类型过滤时必须只返回匹配节点，全球根节点的类型为空不得混入任何类型结果。 */
    @Test
    void getByTypeFiltersNodesByAreaType() {
        assertThat(AreaUtils.getByType(AreaTypeEnum.PROVINCE, Area::getName))
                .contains("北京市", "河南省")
                .doesNotContain("全球", "金水区");
        assertThat(AreaUtils.getByType(AreaTypeEnum.COUNTRY, Area::getId)).contains(Area.ID_CHINA);
        assertThat(AreaUtils.getByType(AreaTypeEnum.DISTRICT, Area::getName)).contains("金水区", "东城区");
    }

    /** 父级回溯必须按目标类型返回最近的祖先编号，包含"自身即目标类型"的情况。 */
    @Test
    void getParentIdByTypeWalksUpToNearestMatchingAncestor() {
        assertThat(AreaUtils.getParentIdByType(JINSHUI_DISTRICT_ID, AreaTypeEnum.DISTRICT))
                .as("自身类型匹配时直接返回自身编号").isEqualTo(JINSHUI_DISTRICT_ID);
        assertThat(AreaUtils.getParentIdByType(JINSHUI_DISTRICT_ID, AreaTypeEnum.CITY)).isEqualTo(ZHENGZHOU_CITY_ID);
        assertThat(AreaUtils.getParentIdByType(JINSHUI_DISTRICT_ID, AreaTypeEnum.PROVINCE)).isEqualTo(HENAN_PROVINCE_ID);
        assertThat(AreaUtils.getParentIdByType(JINSHUI_DISTRICT_ID, AreaTypeEnum.COUNTRY)).isEqualTo(Area.ID_CHINA);
    }

    /** 编号不存在或已到根节点时必须返回 null，表示没有该类型的上级。 */
    @Test
    void getParentIdByTypeReturnsNullWithoutMatchingAncestor() {
        assertThat(AreaUtils.getParentIdByType(Integer.MIN_VALUE, AreaTypeEnum.PROVINCE))
                .as("未知编号必须返回 null").isNull();
        assertThat(AreaUtils.getParentIdByType(Area.ID_GLOBAL, AreaTypeEnum.PROVINCE))
                .as("根节点没有上级").isNull();
    }

    /** 目标类型是必填参数，传 null 必须立即失败而不是返回错误的父级。 */
    @Test
    void getParentIdByTypeRejectsNullType() {
        assertThatThrownBy(() -> AreaUtils.getParentIdByType(JINSHUI_DISTRICT_ID, null))
                .isInstanceOf(NullPointerException.class);
    }

}
