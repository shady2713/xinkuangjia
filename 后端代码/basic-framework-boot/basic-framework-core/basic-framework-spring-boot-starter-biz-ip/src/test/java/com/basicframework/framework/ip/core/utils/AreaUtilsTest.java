package com.basicframework.framework.ip.core.utils;

import cn.hutool.core.io.resource.ResourceUtil;
import com.basicframework.framework.ip.core.Area;
import com.basicframework.framework.ip.core.enums.AreaTypeEnum;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.StringReader;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mockStatic;

/**
 * 验证区域数据的静态加载、路径解析、展示格式化与按类型回溯契约。
 *
 * <p>区域数据来自模块内置的 {@code area.csv}，由静态初始化一次性建立父子索引：索引错位会让
 * 归属地展示与实际地址不符，路径解析失败会让导入的地区列全部为空，父级回溯错误会把统计挂到
 * 别的省市。因此用例按真实数据断言可观察结果，覆盖国家、省市、区县三级与全球根节点。</p>
 *
 * <p>{@code loadAreas} 捕获 {@link java.io.IOException} 的分支不是“资源缺失”保护：Hutool 对资源
 * 缺失或不可读抛的是非受检异常，唯一能产生受检 {@code IOException} 的位置是 try-with-resources 对
 * {@link java.io.BufferedReader} 的 {@code close()}。该分支仍必须保留并验证——关闭失败一旦被静默吞掉，
 * 加载中断会表现成“区域数据少了一部分”而不是启动失败。用例用替身让关闭动作抛出受检异常，
 * 断言它被包装成带原因的 {@link IllegalStateException} 抛出。</p>
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

    /**
     * 关闭区域数据流失败时必须按“读取失败”抛出带原因的非法状态异常。
     *
     * <p>try-with-resources 的隐式关闭是该方法唯一能抛出受检 {@link IOException} 的位置：
     * 资源缺失与读取失败在 Hutool 里都是非受检异常。关闭失败若被静默忽略，区域索引会缺项，
     * 调用方只会看到归属地错误而不是启动失败，因此这里锁定“包装成 IllegalStateException 并保留原因”。</p>
     *
     * <p><b>白盒直调：</b>{@code loadAreas} 是私有静态方法，且 {@code AREAS} 静态字段只初始化一次，
     * 直接调用方法本身才能用替身替换资源读取；替身只替换 {@code ResourceUtil} 的静态方法，
     * 不影响其它用例解析真实 {@code area.csv}。</p>
     *
     * @throws Exception 反射查找失败时抛出
     */
    @Test
    void loadAreasWrapsCheckedCloseFailure() throws Exception {
        try (MockedStatic<ResourceUtil> mocked = mockStatic(ResourceUtil.class)) {
            BufferedReader failingReader = new BufferedReader(new StringReader("id,name,type,parentId\n")) {

                /** 先正常关闭，再抛出受检异常，模拟底层流关闭失败。 */
                @Override
                public void close() throws IOException {
                    super.close();
                    throw new IOException("probe-close-failure");
                }
            };
            mocked.when(() -> ResourceUtil.getUtf8Reader("area.csv")).thenReturn(failingReader);

            Method method = AreaUtils.class.getDeclaredMethod("loadAreas");
            method.setAccessible(true);
            InvocationTargetException thrown = catchThrowableOfType(() -> method.invoke(null),
                    InvocationTargetException.class);

            assertThat(thrown).as("加载失败必须向外抛出而不是返回不完整索引").isNotNull();
            assertThat(thrown.getCause()).isInstanceOf(IllegalStateException.class)
                    .hasMessage("读取区域数据 area.csv 失败")
                    .hasRootCauseInstanceOf(IOException.class);
            mocked.verify(() -> ResourceUtil.getUtf8Reader("area.csv"));
        }
    }

    /**
     * 自身作为父节点的非法数据必须被拒绝，而不是建成自引用节点后静默继续加载。
     *
     * <p>父节点指向自身会让区域树出现自环：{@code format} 与 {@code getParentIdByType}
     * 只能靠迭代次数上限退出，归属地展示与统计归属都会出现难以定位的错误结果。这里用受控的
     * CSV 读取边界把这样一行喂给真实加载器，断言它在建立父子关系前就以固定消息拒绝。</p>
     *
     * <p><b>边界替身：</b>只替换 {@link ResourceUtil#getUtf8Reader} 这一读取边界，CSV 解析、
     * 节点构造、自父判定与拒绝行为都真实执行；被测加载器本身没有被整体替换。</p>
     *
     * @throws Exception 反射查找或调用失败时抛出
     */
    @Test
    void loadAreasRejectsSelfParentedRow() throws Exception {
        String csv = """
                id,name,type,parentId
                110000,北京市,2,110000
                """;
        try (MockedStatic<ResourceUtil> mocked = mockStatic(ResourceUtil.class)) {
            mocked.when(() -> ResourceUtil.getUtf8Reader(eq("area.csv")))
                    .thenReturn(new BufferedReader(new StringReader(csv)));

            Method method = AreaUtils.class.getDeclaredMethod("loadAreas");
            method.setAccessible(true);
            InvocationTargetException thrown = catchThrowableOfType(() -> method.invoke(null),
                    InvocationTargetException.class);

            assertThat(thrown).as("自父节点必须被拒绝，不能建成自引用节点").isNotNull();
            assertThat(thrown.getCause()).isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("北京市")
                    .hasMessageContaining("父子节点相同");
        }
    }

    /**
     * 合法的 CSV 必须建出可用的父子索引与只读索引结果。
     *
     * <p>本用例与自父拒绝用例共用同一条受控读取边界：同样的 CSV 读取方式、同样的反射直调，
     * 只有数据是否合法不同。它证明“自父被拒绝”来自数据判定而不是读取边界替身让加载器整体失效，
     * 同时锁定加载结果不可变这一契约。</p>
     *
     * @throws Exception 反射查找或调用失败时抛出
     */
    @Test
    @SuppressWarnings("unchecked")
    void loadAreasBuildsReadOnlyIndexForValidRows() throws Exception {
        String csv = """
                id,name,type,parentId
                1,中国,1,0
                110000,北京市,2,1
                110100,北京市,3,110000
                """;
        try (MockedStatic<ResourceUtil> mocked = mockStatic(ResourceUtil.class)) {
            mocked.when(() -> ResourceUtil.getUtf8Reader(eq("area.csv")))
                    .thenReturn(new BufferedReader(new StringReader(csv)));

            Map<Integer, Area> areas = invokeLoadAreas();

            Area province = areas.get(110000);
            Area city = areas.get(110100);
            assertThat(province).isNotNull();
            assertThat(city).as("子节点必须挂到父节点的子列表上").isSameAs(province.getChildren().get(0));
            assertThat(city.getParent()).isSameAs(province);
            assertThat(province.getParent()).as("父节点必须来自 CSV 中的父编号").isSameAs(areas.get(Area.ID_CHINA));
            assertThat(province.getParent().getParent()).as("国家级父节点挂到预置的全球根节点")
                    .isSameAs(areas.get(Area.ID_GLOBAL));
            assertThat(areas).as("加载结果必须是只读索引").isNotInstanceOf(java.util.HashMap.class);
            assertThatThrownBy(() -> areas.put(1, city)).isInstanceOf(UnsupportedOperationException.class);
        }
    }

    /**
     * 区域父引用成环时必须由有界回溯退出并返回 null，不得让调用方无限等待。
     *
     * <p>公开的 {@code setParent} 允许把任意节点接成环；一旦成环，按类型回溯就没有“找到根节点”
     * 这一出口，只能依赖迭代次数上限。若上限出口被删掉，归属地查询会变成死循环并拖垮请求线程。
     * 用例取得真实索引里的节点，破坏父引用后调用真实的公开回溯方法，并在 finally 中恢复。</p>
     *
     * <p><b>真实索引接缝：</b>{@code AREAS} 是私有静态只读索引，方法内部直接读取它；
     * 用例不替换索引、不替换被测方法，只用真实公开 setter 构造环输入，结束后原样恢复父引用，
     * 避免污染同 JVM 内其它区域用例。</p>
     *
     * @throws Exception 反射查找或索引检查失败时抛出
     */
    @Test
    void getParentIdByTypeReturnsNullWhenParentReferenceCycles() throws Exception {
        Area province = AreaUtils.getArea(BEIJING_PROVINCE_ID);
        assertThat(province).as("真实索引必须包含北京市节点").isNotNull();
        assertThat(province.getParent()).as("真实索引中北京市的父节点必须是中国").isNotNull();
        Area originalParent = province.getParent();
        try {
            province.setParent(province);

            assertThat(AreaUtils.getParentIdByType(BEIJING_PROVINCE_ID, AreaTypeEnum.DISTRICT))
                    .as("父引用成环时必须由迭代上限退出并返回 null，而不是死循环")
                    .isNull();
        } finally {
            province.setParent(originalParent);
        }
        assertThat(AreaUtils.getParentIdByType(BEIJING_PROVINCE_ID, AreaTypeEnum.PROVINCE))
                .as("恢复真实父引用后正常回溯必须仍然可用")
                .isEqualTo(BEIJING_PROVINCE_ID);
    }

    /**
     * 反射调用真实加载器并返回它建出的索引。
     *
     * @return 加载器返回的区域索引
     * @throws Exception 反射查找或调用失败时抛出
     */
    @SuppressWarnings("unchecked")
    private static Map<Integer, Area> invokeLoadAreas() throws Exception {
        Method method = AreaUtils.class.getDeclaredMethod("loadAreas");
        method.setAccessible(true);
        try {
            return (Map<Integer, Area>) method.invoke(null);
        } catch (InvocationTargetException exception) {
            throw (Exception) exception.getCause();
        }
    }

}
