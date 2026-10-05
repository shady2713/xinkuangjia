package com.basicframework.module.system.framework.captcha.core;

import com.anji.captcha.model.common.RepCodeEnum;
import com.anji.captcha.model.common.ResponseModel;
import com.anji.captcha.model.vo.CaptchaVO;
import com.anji.captcha.util.ImageUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.test.util.ReflectionTestUtils;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Font;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Base64;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.spy;

/**
 * 验证管理平台滑块验证码的底图加载、水印绘制与生成结果契约。
 *
 * <p>该实现与业务平台分开加载 aj-captcha 依赖自带的默认图库，避免两个平台争用同一份全局图片
 * 缓存。生成结果必须是可解码的底图与拼图块，否则前端滑块无法渲染；水印未配置时不得改动底图
 * 像素，配置后必须真实绘制到图上。用例直接消费依赖包内的真实默认图库，不做图片替身。</p>
 *
 * @author shady2713
 */
class AdminDefaultBlockPuzzleCaptchaServiceImplTest {

    /** 被测验证码实现。 */
    private AdminDefaultBlockPuzzleCaptchaServiceImpl captchaService;
    /** 用例开始前的静态水印文本，结束后原样恢复。 */
    private String previousWaterMark;

    /** 为每个用例创建独立实例并记录静态水印文本。 */
    @BeforeEach
    void setUp() {
        captchaService = new AdminDefaultBlockPuzzleCaptchaServiceImpl();
        previousWaterMark = (String) ReflectionTestUtils.getField(captchaService, "waterMark");
    }

    /** 还原静态水印文本，避免影响同 JVM 内的其他验证码用例。 */
    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(captchaService, "waterMark", previousWaterMark);
    }

    /**
     * 生成验证码必须返回可解码的底图与拼图块，且两者不是同一张图片。
     */
    @Test
    void getReturnsDecodableOriginalAndSlidingBlock() throws Exception {
        ResponseModel response = captchaService.get(new CaptchaVO());

        assertThat(response.isSuccess()).as("默认图库可用时必须生成成功").isTrue();
        CaptchaVO result = (CaptchaVO) response.getRepData();
        assertThat(result.getOriginalImageBase64()).isNotBlank();
        assertThat(result.getJigsawImageBase64()).isNotBlank();
        BufferedImage original = decode(result.getOriginalImageBase64());
        BufferedImage slidingBlock = decode(result.getJigsawImageBase64());
        assertThat(original).as("底图必须可解码").isNotNull();
        assertThat(slidingBlock).as("拼图块必须可解码").isNotNull();
        assertThat(result.getOriginalImageBase64()).as("拼图块不得复用底图内容")
                .isNotEqualTo(result.getJigsawImageBase64());
        assertThat(original.getWidth()).isGreaterThan(slidingBlock.getWidth());
    }

    /**
     * 未配置水印时不得在底图上绘制任何像素。
     */
    @Test
    void drawWaterMarkLeavesImageUntouchedWithoutWaterMark() {
        ReflectionTestUtils.setField(captchaService, "waterMark", "  ");
        BufferedImage image = blackImage();

        ReflectionTestUtils.invokeMethod(captchaService, "drawWaterMark", image);

        assertThat(containsNonBlackPixel(image)).as("无水印时底图必须保持原样").isFalse();
    }

    /**
     * 配置水印后必须把文本真实绘制到底图上，且不抛异常。
     */
    @Test
    void drawWaterMarkPaintsTextWhenConfigured() {
        ReflectionTestUtils.setField(captchaService, "waterMark", "管理平台");
        ReflectionTestUtils.setField(captchaService, "waterMarkFont", new Font(Font.SANS_SERIF, Font.PLAIN, 20));
        BufferedImage image = blackImage();

        ReflectionTestUtils.invokeMethod(captchaService, "drawWaterMark", image);

        assertThat(containsNonBlackPixel(image)).as("配置水印后底图必须出现绘制像素").isTrue();
    }

    /**
     * 生成验证码时同样走水印绘制分支，配置水印后仍能正常出图。
     */
    @Test
    void getSucceedsWithConfiguredWaterMark() {
        ReflectionTestUtils.setField(captchaService, "waterMark", "管理平台");
        ReflectionTestUtils.setField(captchaService, "waterMarkFont", new Font(Font.SANS_SERIF, Font.PLAIN, 20));

        ResponseModel response = captchaService.get(new CaptchaVO());

        assertThat(response.isSuccess()).isTrue();
        assertThat(((CaptchaVO) response.getRepData()).getOriginalImageBase64()).isNotBlank();
    }

    /**
     * 构造纯黑底图，便于检测是否被绘制过。
     *
     * @return 纯黑图片
     */
    private static BufferedImage blackImage() {
        BufferedImage image = new BufferedImage(200, 100, BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics graphics = image.getGraphics();
        graphics.setColor(Color.BLACK);
        graphics.fillRect(0, 0, image.getWidth(), image.getHeight());
        graphics.dispose();
        return image;
    }

    /**
     * 判断图片中是否存在非黑像素。
     *
     * @param image 待检测图片
     * @return 存在非黑像素时返回 true
     */
    private static boolean containsNonBlackPixel(BufferedImage image) {
        for (int x = 0; x < image.getWidth(); x++) {
            for (int y = 0; y < image.getHeight(); y++) {
                if ((image.getRGB(x, y) & 0xFFFFFF) != 0) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 解码 Base64 图片，内容非法时返回 null。
     *
     * @param base64 Base64 图片内容
     * @return 图片对象或 null
     * @throws Exception 解码失败时抛出
     */
    private static BufferedImage decode(String base64) throws Exception {
        assertThat(ImageUtils.getBase64StrToImage(base64)).as("工具解码结果必须与断言一致").isNotNull();
        return ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(base64)));
    }

    /**
     * 可读但不可解码为图片的素材必须被拒绝，而不是当成有效底图参与生成。
     *
     * <p>加载器把「读到字节」和「拿到图片」分开判断：只保留能解码的素材，否则后续裁剪会拿到空图，
     * 让登录关键路径出现难以定位的失败。这里用一条独立的非图片探针资源校验该边界，并保留一条
     * 真实依赖素材的正对照，证明 null 来自图片解码判定而不是资源找不到。</p>
     *
     * <p><b>白盒直调：</b>{@code loadDefaultImage} 是私有静态方法，生产调用点只传依赖包内置的
     * {@code defaultImages/jigsaw/original|slidingBlock/1..6.png}；探针资源使用独立路径，
     * 不遮蔽依赖包素材，也不改变本模块其它用例的类路径解析结果。</p>
     */
    @Test
    void loadDefaultImageRejectsReadableNonImageResource() throws Exception {
        assertThat(loadDefaultImage("captcha-probe-not-an-image.png"))
                .as("读到字节但解不出图片时必须返回 null 并从候选列表剔除").isNull();
        assertThat((String) loadDefaultImage("defaultImages/jigsaw/original/1.png"))
                .as("正对照：依赖包内真实图片必须返回非空 Base64").isNotBlank();
    }

    /**
     * 反射调用私有默认素材加载器，观察它对指定路径的真实返回。
     *
     * @param path 类路径上的资源路径
     * @return 加载成功时的 Base64 文本，不可用时为 null
     * @throws Exception 反射调用失败（含被测方法抛出的异常）时抛出
     */
    private static Object loadDefaultImage(String path) throws Exception {
        Method method = AdminDefaultBlockPuzzleCaptchaServiceImpl.class.getDeclaredMethod("loadDefaultImage", String.class);
        method.setAccessible(true);
        try {
            return method.invoke(null, path);
        } catch (InvocationTargetException exception) {
            throw (Exception) exception.getCause();
        }
    }

    /**
     * 默认底图解码失败时必须返回“底图缺失”业务码，而不是带着空图继续裁剪。
     *
     * <p>依赖包图库在类初始化时一次性加载，正常情况下永远非空；但解码失败（图库损坏、依赖升级换格式）
     * 会让裁剪拿到空图并在后续抛空指针，客户端只能看到 500。这里锁定“解码为空即返回业务错误码”。</p>
     *
     * <p><b>白盒直调：</b>静态素材列表是 {@code static final} 且由真实图库填充，无法替换；
     * 用例改用公开静态解码方法 {@code ImageUtils.getBase64StrToImage} 的替身让解码返回空，
     * 从而在不改动生产代码与依赖素材的前提下触发该分支。</p>
     */
    @Test
    void getReportsBasemapMissingWhenDefaultImageCannotBeDecoded() {
        try (MockedStatic<ImageUtils> mocked = mockStatic(ImageUtils.class)) {
            mocked.when(() -> ImageUtils.getBase64StrToImage(anyString())).thenReturn(null);

            ResponseModel response = captchaService.get(new CaptchaVO());

            assertThat(response.isSuccess()).as("底图解码失败时必须按失败返回").isFalse();
            assertThat(response.getRepCode()).isEqualTo(RepCodeEnum.API_CAPTCHA_BASEMAP_NULL.getCode());
            assertThat(response.getRepData()).isNull();
        }
    }

    /**
     * 拼图块解码失败时必须返回“底图缺失”业务码，且不得进入裁剪与出图流程。
     *
     * <p>底图正常而拼图块解码失败是图库部分损坏的典型表现：此时若继续裁剪，
     * 前端拿到的是缺块的验证码，用户永远无法通过校验。这里锁定“第二张图解码为空即失败”。</p>
     *
     * <p><b>白盒直调：</b>同上一用例，用解码方法的替身让第一次调用（底图）返回真实图片、
     * 第二次调用（拼图块）返回空，精确命中拼图块为空的判定分支。</p>
     */
    @Test
    void getReportsBasemapMissingWhenSlidingBlockCannotBeDecoded() {
        try (MockedStatic<ImageUtils> mocked = mockStatic(ImageUtils.class)) {
            BufferedImage decodedOriginal = new BufferedImage(16, 16, BufferedImage.TYPE_INT_RGB);
            mocked.when(() -> ImageUtils.getBase64StrToImage(anyString()))
                    .thenReturn(decodedOriginal).thenReturn(null);

            ResponseModel response = captchaService.get(new CaptchaVO());

            assertThat(response.isSuccess()).as("拼图块解码失败时必须按失败返回").isFalse();
            assertThat(response.getRepCode()).isEqualTo(RepCodeEnum.API_CAPTCHA_BASEMAP_NULL.getCode());
        }
    }

    /**
     * 裁剪结果缺少底图或拼图块时必须返回验证码错误码，而不是把残缺结果发给前端。
     *
     * <p>裁剪由依赖包实现，返回 null 或缺少任一 Base64 字段时前端无法渲染滑块；
     * 这属于可预期的业务失败，必须给出明确的错误码而不是让前端解析空对象。</p>
     *
     * <p><b>白盒直调：</b>{@code pictureTemplatesCut} 是父类 public 方法，用例用 {@code spy}
     * 打桩让它返回 null，复用仓库既有的 spy 手法；底图与拼图块仍走真实图库。</p>
     */
    @Test
    void getReportsCaptchaErrorWhenTemplateCutProducesNothing() {
        AdminDefaultBlockPuzzleCaptchaServiceImpl spiedService =
                spy(new AdminDefaultBlockPuzzleCaptchaServiceImpl());
        doReturn(null).when(spiedService).pictureTemplatesCut(any(), any(), anyString());

        ResponseModel response = spiedService.get(new CaptchaVO());

        assertThat(response.isSuccess()).as("裁剪无结果时必须按业务失败返回").isFalse();
        assertThat(response.getRepCode()).isEqualTo(RepCodeEnum.API_CAPTCHA_ERROR.getCode());
        assertThat(response.getRepData()).isNull();
    }

    /**
     * 候选素材为空时必须返回 null，而不是抛出越界异常。
     *
     * <p>{@code randomBase64} 的入参是参数化列表，生产调用点只传类初始化时填充的静态列表，
     * 因此“空列表”在生产路径不可达；但空列表守卫是该方法对入参的完整契约，
     * 一旦被删掉，任何传入空集合的新调用点都会把随机取值变成越界异常。</p>
     *
     * <p><b>白盒直调：</b>方法私有且静态，反射直接传入空列表；同时用单元素列表做正对照，
     * 证明返回 null 来自空集合判定而不是方法被整体替换。</p>
     *
     * @throws Exception 反射查找或调用失败时抛出
     */
    @Test
    void randomBase64ReturnsNullForEmptyCandidates() throws Exception {
        Method method = AdminDefaultBlockPuzzleCaptchaServiceImpl.class.getDeclaredMethod("randomBase64", List.class);
        method.setAccessible(true);

        assertThat(method.invoke(null, List.of())).as("空候选必须返回 null").isNull();
        assertThat(method.invoke(null, List.of("candidate"))).as("正对照：单元素候选必须原样返回")
                .isEqualTo("candidate");
    }

    /**
     * 默认素材路径不存在时必须返回 null 并跳过该素材，而不是让类初始化失败。
     *
     * <p>类初始化按编号 1..6 逐个读取依赖包图库，任一编号缺失都会被过滤掉；
     * 这条守卫决定了“图库少一张图”只会减少可选用素材，而不是让登录页整体不可用。</p>
     *
     * <p><b>白盒直调：</b>{@code loadDefaultImage} 是私有静态方法，生产调用点只传依赖包内置路径，
     * 这里复用例内已有的反射助手，传一条确定不存在的路径。</p>
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void loadDefaultImageReturnsNullForMissingResource() throws Exception {
        assertThat(loadDefaultImage("captcha/does-not-exist-probe.png"))
                .as("资源不存在时必须返回 null").isNull();
    }

    /**
     * 素材读取或解码抛出受检 IOException 时必须返回 null，而不是让类初始化失败。
     *
     * <p>读取发生在 try-with-resources 中：截断图片会让 {@code ImageIO.read} 抛出
     * {@code IIOException}（{@link java.io.IOException} 的子类），关闭流也可能失败；
     * 这条 catch 是“依赖包素材损坏不影响启动”的兜底，删掉会让整个验证码实现无法加载。</p>
     *
     * <p><b>白盒直调：</b>生产调用点只传依赖包内置的完整 PNG，因此用一个独立的截断 PNG 探针
     * （真实 PNG 的前 40 字节）触发该分支。用例先断言探针本身确实会让 {@code ImageIO.read}
     * 抛出 {@link java.io.IOException}，再断言加载器把这次失败降级为 null，
     * 避免“探针其实走了另一个分支”导致用例名不副实。</p>
     *
     * @throws Exception 读取探针或反射调用失败时抛出
     */
    @Test
    void loadDefaultImageReturnsNullWhenProbeImageIsTruncated() throws Exception {
        byte[] probe = readProbe("captcha-probe-truncated.png");
        assertThatThrownBy(() -> ImageIO.read(new ByteArrayInputStream(probe)))
                .as("探针必须是会让解码抛 IOException 的截断 PNG，否则本用例证明不了 catch 分支")
                .isInstanceOf(IOException.class);

        assertThat(loadDefaultImage("captcha-probe-truncated.png"))
                .as("解码抛受检异常时必须返回 null 并跳过该素材").isNull();
    }

    /**
     * 读取类路径探针资源的全部字节。
     *
     * @param path 类路径资源路径
     * @return 资源字节内容
     * @throws Exception 资源不存在或读取失败时抛出
     */
    private static byte[] readProbe(String path) throws Exception {
        try (java.io.InputStream inputStream =
                     AdminDefaultBlockPuzzleCaptchaServiceImplTest.class.getClassLoader().getResourceAsStream(path)) {
            assertThat(inputStream).as("探针资源必须存在：" + path).isNotNull();
            return inputStream.readAllBytes();
        }
    }

}
