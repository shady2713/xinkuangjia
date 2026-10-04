package com.basicframework.framework.ip.core.utils;

import com.basicframework.framework.ip.core.Area;
import org.junit.jupiter.api.Test;
import org.lionsoul.ip2region.xdb.Searcher;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 IP 工具类基于内置 ip2region 数据的真实查询结果。
 *
 * <p>该工具类在首次使用时把 {@code ip2region.xdb} 加载进内存，为登录日志、审计与地区统计提供
 * IP → 地区编号的解析能力。解析结果直接决定日志归属地，必须锁定可观察契约：</p>
 * <ul>
 *   <li>字符串入口按 IP 文本查询，且先去除首尾空白（请求头里的 IP 常带空格）；</li>
 *   <li>长整型入口与 {@link Searcher#checkIP(String)} 的编码一致，两个重载对同一 IP 必须得到同一结果；</li>
 *   <li>地区入口必须等价于"先取编号再按编号查地区表"，且返回的是地区表中的同一节点；</li>
 *   <li>内网/保留地址映射到编号 0（全球根节点），未知格式的 IP 抛出解析异常而不是返回错误地区。</li>
 * </ul>
 *
 * <p>断言使用的编号取值来自仓库内置数据文件：{@code 114.114.114.114 → 320100（南京市）}、
 * {@code 8.8.8.8 → 166（美国）}。这些取值随数据文件版本固定，不是随运行环境变化的随机值。</p>
 *
 * @author shady2713
 */
class IPUtilsTest {

    /** 可解析到明确城市的公网 IP，用于校验编号与地区。 */
    private static final String NANJING_IP = "114.114.114.114";
    /** 南京市在地区表中的编号。 */
    private static final int NANJING_AREA_ID = 320100;
    /** 可解析到国家的公网 IP。 */
    private static final String USA_IP = "8.8.8.8";
    /** 美国在地区表中的编号。 */
    private static final int USA_AREA_ID = 166;

    /** 字符串入口必须返回公网 IP 对应的地区编号，并忽略首尾空白。 */
    @Test
    void getAreaIdByStringResolvesPublicIpAndTrimsInput() {
        assertThat(IPUtils.getAreaId(NANJING_IP)).isEqualTo(NANJING_AREA_ID);
        assertThat(IPUtils.getAreaId(" " + NANJING_IP + " ")).as("首尾空白必须被去除后再解析")
                .isEqualTo(NANJING_AREA_ID);
    }

    /**
     * 长整型入口必须与 IP 文本入口得到同一编号。
     *
     * <p>{@link Searcher#checkIP(String)} 是 ip2region 对 IP 文本的官方编码方式，
     * 两个重载若使用不同编码，同一条日志按不同入口会落到不同地区。</p>
     */
    @Test
    void getAreaIdByLongMatchesStringEntry() throws Exception {
        assertThat(IPUtils.getAreaId(Searcher.checkIP(NANJING_IP))).isEqualTo(IPUtils.getAreaId(NANJING_IP));
        assertThat(IPUtils.getAreaId(Searcher.checkIP(USA_IP))).isEqualTo(USA_AREA_ID);
    }

    /**
     * 超出 IP 编码范围的长整型必须以解析失败告终，不得返回错误的地区编号。
     *
     * <p>参数约定是 {@link Searcher#checkIP(String)} 的返回值（32 位无符号地址），越界输入没有对应地区。
     * 实测行为：{@code -1} 在底层查询器中无匹配，包装层的整数解析抛出
     * {@link NumberFormatException}；更大的越界值会让底层查询器内部数组越界抛出
     * {@link ArrayIndexOutOfBoundsException}（属底层实现细节，已作为待处理发现记录，不在本用例中当作契约）。</p>
     */
    @Test
    void outOfRangeLongFailsInsteadOfReturningWrongArea() {
        assertThatThrownBy(() -> IPUtils.getAreaId(-1L)).isInstanceOf(NumberFormatException.class);
        assertThatThrownBy(() -> IPUtils.getAreaId(Long.MAX_VALUE))
                .isInstanceOf(ArrayIndexOutOfBoundsException.class);
    }

    /** 地区入口必须返回地区表中与编号对应的同一节点。 */
    @Test
    void getAreaReturnsSameNodeAsAreaTable() throws Exception {
        Area byIp = IPUtils.getArea(NANJING_IP);

        assertThat(byIp).isSameAs(AreaUtils.getArea(NANJING_AREA_ID));
        assertThat(byIp.getId()).isEqualTo(NANJING_AREA_ID);
        assertThat(byIp.getName()).as("地区名称必须来自地区表").isEqualTo("南京市");
        assertThat(IPUtils.getArea(Searcher.checkIP(NANJING_IP)))
                .as("字符串与长整型入口必须查同一地区").isSameAs(byIp);
        assertThat(IPUtils.getArea(USA_IP).getName()).isEqualTo("美国");
    }

    /**
     * 内网地址映射到全球根节点，未知格式的地址必须显式失败。
     *
     * <p>内网地址在数据文件中没有具体地区，工具类返回编号 0，调用方据此识别"无地区信息"；
     * 非法文本没有可归属地区，必须抛出解析异常，不能静默落到某个默认地区。</p>
     */
    @Test
    void privateIpMapsToRootAndInvalidIpFails() {
        assertThat(IPUtils.getAreaId("192.168.1.1")).as("内网地址映射到编号 0").isZero();
        assertThat(IPUtils.getArea("127.0.0.1")).as("编号 0 对应地区表根节点").isSameAs(AreaUtils.getArea(Area.ID_GLOBAL));
        assertThatThrownBy(() -> IPUtils.getAreaId("not-an-ip"))
                .as("非法 IP 必须显式失败").hasMessageContaining("invalid ip address");
        assertThatThrownBy(() -> IPUtils.getAreaId("300.300.300.300"))
                .as("越界网段同样必须显式失败").hasMessageContaining("should be less then 256");
    }

}
