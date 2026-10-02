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
     * 加载DefaultImage。
     */
    private static String loadDefaultImage(String path) {
        ClassLoader classLoader = AdminDefaultBlockPuzzleCaptchaServiceImpl.class.getClassLoader();
        try (InputStream inputStream = classLoader.getResourceAsStream(path)) {
            if (inputStream == null) {
                log.warn("管理平台滑块验证码默认资源不存在: {}", path);
                return null;
            }
            // aj-captcha 的裁剪方法接收 Base64 拼图块，这里统一按依赖包默认图片转码。
            byte[] bytes = inputStream.readAllBytes();
            if (ImageIO.read(new java.io.ByteArrayInputStream(bytes)) == null) {
                log.warn("管理平台滑块验证码默认资源不是有效图片: {}", path);
                return null;
            }
            return Base64.getEncoder().encodeToString(bytes);
        } catch (IOException exception) {
            log.warn("管理平台滑块验证码默认资源读取失败: {}", path, exception);
            return null;
        }
    }
}
