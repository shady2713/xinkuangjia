package com.basicframework.module.system.framework.captcha.core;

import cn.hutool.core.util.StrUtil;
import com.anji.captcha.model.common.RepCodeEnum;
import com.anji.captcha.model.common.ResponseModel;
import com.anji.captcha.model.vo.CaptchaVO;
import com.anji.captcha.service.impl.BlockPuzzleCaptchaServiceImpl;
import com.anji.captcha.util.ImageUtils;
import lombok.extern.slf4j.Slf4j;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Function;

/**
 * 管理平台专用滑块验证码。
 *
 * <p>业务平台继续使用 {@code blockPuzzle} 和项目自定义无人机底图；管理平台使用该类型，
 * 从 aj-captcha 依赖包自带的默认图库读取旧版底图，避免两个平台争用同一个全局图片缓存。</p>
 * @author 李杰
 */
@Slf4j
public class AdminDefaultBlockPuzzleCaptchaServiceImpl extends BlockPuzzleCaptchaServiceImpl {

    public static final String CAPTCHA_TYPE = "adminBlockPuzzle";

    private static final String DEFAULT_ORIGINAL_PATH = "defaultImages/jigsaw/original/%s.png";
    private static final String DEFAULT_SLIDING_BLOCK_PATH = "defaultImages/jigsaw/slidingBlock/%s.png";
    private static final int DEFAULT_IMAGE_COUNT = 6;

    /**
     * 默认素材的资源读取接缝，默认从本类所在类加载器按类路径读取 aj-captcha 依赖包内置图片。
     *
     * <p>这是本类唯一的内部接缝：真实加载路径与类初始化始终使用默认实现，测试只在隔离作用域内
     * 临时替换并在 {@code finally} 中恢复，用来确定性地驱动「资源不存在」「素材可读但不是图片」
     * 「素材可用」三类资源状态，并观察加载器对底层流的关闭动作。它不是环境变量、配置文件项或
     * 公开 API，外部输入无法改变它，替换它也不改变读取与关闭语义，只改变流的来源。</p>
     *
     * <p>字段必须声明在下方静态素材列表之前：那两个列表在类初始化时就会调用加载器，
     * 若接缝此时尚未赋值，类初始化会取到 null 而不是默认实现。</p>
     */
    @SuppressWarnings("PMD.MutableStaticState") // 有意的测试接缝：包级可见以便同包测试替换读取动作；已 volatile，且 JavaDoc 说明它不是外部输入。
    static volatile Function<String, InputStream> defaultImageResourceOpener =
            path -> AdminDefaultBlockPuzzleCaptchaServiceImpl.class.getClassLoader().getResourceAsStream(path);

    private static final List<String> ORIGINAL_IMAGES = loadDefaultImages(DEFAULT_ORIGINAL_PATH);
    private static final List<String> SLIDING_BLOCK_IMAGES = loadDefaultImages(DEFAULT_SLIDING_BLOCK_PATH);

    /**
     * 返回当前验证码实现支持的验证码类型。
     *
     * @return 方法处理结果
     */
    @Override
    public String captchaType() {
        return CAPTCHA_TYPE;
    }

    /**
     * 获取目标数据。
     *
     * @param captchaVO captchaVO 参数
     * @return 查询或转换后的结果
     */
    @Override
    public ResponseModel get(CaptchaVO captchaVO) {
        BufferedImage originalImage = randomImage(ORIGINAL_IMAGES);
        if (originalImage == null) {
            log.error("管理平台滑块验证码默认底图未初始化成功，请检查 aj-captcha 依赖资源");
            return ResponseModel.errorMsg(RepCodeEnum.API_CAPTCHA_BASEMAP_NULL);
        }

        String slidingBlockBase64 = randomBase64(SLIDING_BLOCK_IMAGES);
        BufferedImage slidingBlockImage = ImageUtils.getBase64StrToImage(slidingBlockBase64);
        if (slidingBlockImage == null) {
            log.error("管理平台滑块验证码默认拼图块未初始化成功，请检查 aj-captcha 依赖资源");
            return ResponseModel.errorMsg(RepCodeEnum.API_CAPTCHA_BASEMAP_NULL);
        }

        drawWaterMark(originalImage);
        CaptchaVO result = pictureTemplatesCut(originalImage, slidingBlockImage, slidingBlockBase64);
        if (result == null || StrUtil.isBlank(result.getJigsawImageBase64())
                || StrUtil.isBlank(result.getOriginalImageBase64())) {
            return ResponseModel.errorMsg(RepCodeEnum.API_CAPTCHA_ERROR);
        }
        return ResponseModel.successData(result);
    }

    /**
     * 在目标图片上绘制业务水印。
     *
     * @param originalImage originalImage 参数
     */
    private void drawWaterMark(BufferedImage originalImage) {
        if (StrUtil.isBlank(waterMark)) {
            return;
        }
        Graphics graphics = originalImage.getGraphics();
        try {
            graphics.setFont(waterMarkFont);
            graphics.setColor(Color.WHITE);
            graphics.drawString(waterMark,
                    originalImage.getWidth() - getEnOrChLength(waterMark),
                    originalImage.getHeight() - HAN_ZI_SIZE / 2 + 7);
        } finally {
            graphics.dispose();
        }
    }

    /**
     * 生成随机Image。
     *
     * @param images images 数据集合
     * @return 方法处理结果
     */
    private static BufferedImage randomImage(List<String> images) {
        String base64 = randomBase64(images);
        return StrUtil.isBlank(base64) ? null : ImageUtils.getBase64StrToImage(base64);
    }

    /**
     * 生成随机Base64。
     *
     * @param images images 数据集合
     * @return 方法处理结果
     */
    private static String randomBase64(List<String> images) {
        if (images.isEmpty()) {
            return null;
        }
        return images.get(ThreadLocalRandom.current().nextInt(images.size()));
    }

    /**
     * 加载DefaultImages。
     */
    private static List<String> loadDefaultImages(String pathTemplate) {
        return java.util.stream.IntStream.rangeClosed(1, DEFAULT_IMAGE_COUNT)
                .mapToObj(index -> loadDefaultImage(pathTemplate.formatted(index)))
                .filter(StrUtil::isNotBlank)
                .toList();
    }

    /**
     * 按路径加载依赖包内置的默认素材，失败时降级为「该素材不可用」。
     *
     * <p>两类可预期失败（资源不存在、素材可读但解不出图片）统一收敛到同一条返回语句，成功路径单独返回。
     * 这样 try-with-resources 的隐式关闭守卫在失败路径上面对的是真实的「流为空」与「流非空」两种状态：
     * 空流不关闭、非空流必然关闭，而不是为每个提前返回各复制一份关闭代码、其中一份恒定不可达。
     * 读取或关闭阶段抛出的受检异常仍由同一个 catch 统一降级为 null 并记录告警，语义不变。</p>
     *
     * @param path 类路径上的默认素材路径，取值来自依赖包内置图库
     * @return 素材字节的 Base64 文本；资源不存在、素材不可解码或读取失败时返回 null，由调用方过滤该素材
     */
    private static String loadDefaultImage(String path) {
        try (InputStream inputStream = defaultImageResourceOpener.apply(path)) {
            String base64 = null;
            if (inputStream == null) {
                log.warn("管理平台滑块验证码默认资源不存在: {}", path);
            } else {
                byte[] bytes = inputStream.readAllBytes();
                // aj-captcha 的裁剪方法接收 Base64 拼图块，这里统一按依赖包默认图片转码。
                if (ImageIO.read(new java.io.ByteArrayInputStream(bytes)) == null) {
                    log.warn("管理平台滑块验证码默认资源不是有效图片: {}", path);
                } else {
                    base64 = Base64.getEncoder().encodeToString(bytes);
                }
            }
            // 资源缺失与非图片素材都从这里返回 null，关闭动作仍由 try-with-resources 统一负责。
            if (base64 == null) {
                return null;
            }
            return base64;
        } catch (IOException exception) {
            log.warn("管理平台滑块验证码默认资源读取失败: {}", path, exception);
            return null;
        }
    }
}
