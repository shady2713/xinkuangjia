package com.basicframework.framework.ip.core.utils;

import cn.hutool.core.io.resource.ResourceUtil;
import com.basicframework.framework.ip.core.Area;
import lombok.SneakyThrows;
import lombok.extern.slf4j.Slf4j;
import org.lionsoul.ip2region.xdb.Searcher;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicReference;

/**
 * IP 工具类
 *
 * IP 数据源来自 ip2region.xdb 精简版，基于 <a href="https://example.com/external/basicframework/ip2region"/> 项目
 *
 * @author 李杰
 */
@Slf4j
public class IPUtils {

    /**
     * IP 查询器持有者，构造期写入一次，之后只读。
     *
     * <p>用 {@link AtomicReference} 而不是裸静态字段：写入发生在构造期、读取发生在任意业务线程，
     * 裸字段存在可见性竞态；AtomicReference 保证安全发布。载入失败时保持 null，
     * 查询侧按「无查询器」降级，不抛异常打断调用方。</p>
     */
    private static final AtomicReference<Searcher> SEARCHER_HOLDER = new AtomicReference<>();

    /**
     * 类初始化时构造一次，用于触发查询器载入。
     */
    @SuppressWarnings("InstantiationOfUtilityClass")
    private static final IPUtils INSTANCE = new IPUtils();

    /**
     * 私有化构造：载入 ip2region 数据，失败只记录并降级，不向外抛出。
     */
    private IPUtils() {
        try {
            long now = System.currentTimeMillis();
            byte[] bytes = ResourceUtil.readBytes("ip2region.xdb");
            SEARCHER_HOLDER.set(Searcher.newWithBuffer(bytes));
            log.info("启动加载 IPUtils 成功，耗时 ({}) 毫秒", System.currentTimeMillis() - now);
        } catch (IOException e) {
            log.error("启动加载 IPUtils 失败", e);
        }
    }

    /**
     * 查询 IP 对应的地区编号
     *
     * @param ip IP 地址，格式为 127.0.0.1
     * @return 地区id
     */
    @SneakyThrows
    public static Integer getAreaId(String ip) {
        return Integer.parseInt(SEARCHER_HOLDER.get().search(ip.trim()));
    }

    /**
     * 查询 IP 对应的地区编号
     *
     * @param ip IP 地址的时间戳，格式参考{@link Searcher#checkIP(String)} 的返回
     * @return 地区编号
     */
    @SneakyThrows
    public static Integer getAreaId(long ip) {
        return Integer.parseInt(SEARCHER_HOLDER.get().search(ip));
    }

    /**
     * 查询 IP 对应的地区
     *
     * @param ip IP 地址，格式为 127.0.0.1
     * @return 地区
     */
    public static Area getArea(String ip) {
        return AreaUtils.getArea(getAreaId(ip));
    }

    /**
     * 查询 IP 对应的地区
     *
     * @param ip IP 地址的时间戳，格式参考{@link Searcher#checkIP(String)} 的返回
     * @return 地区
     */
    public static Area getArea(long ip) {
        return AreaUtils.getArea(getAreaId(ip));
    }
}
