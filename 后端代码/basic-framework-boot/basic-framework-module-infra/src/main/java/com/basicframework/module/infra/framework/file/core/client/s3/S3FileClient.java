/** 基于 S3 协议提供文件读写、复制、签名与元数据分页。 */
package com.basicframework.module.infra.framework.file.core.client.s3;

import cn.hutool.core.util.BooleanUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.http.HttpUtil;
import com.basicframework.framework.common.util.http.HttpUtils;
import com.basicframework.module.infra.framework.file.core.client.AbstractFileClient;
import com.basicframework.module.infra.framework.file.core.client.FileObjectPage;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.CommonPrefix;
import software.amazon.awssdk.services.s3.model.CopyObjectRequest;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Object;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

import java.io.IOException;
import java.net.URI;
import java.net.URL;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * 基于 S3 协议的文件客户端，实现 MinIO、阿里云、腾讯云、七牛云、华为云等云服务。
 *
 * <p>客户端初始化和刷新会替换 SDK 连接资源，应用关闭时必须调用 {@link #close()}。</p>
 *
 * @author 李杰
 */
public class S3FileClient extends AbstractFileClient<S3FileClientConfig> {

    private static final Duration EXPIRATION_DEFAULT = Duration.ofHours(24);

    private S3Client client;
    private S3Presigner presigner;

    /**
     * 分页读取当前桶对象大小，单次请求最多 1000 条且总超时为 3 秒。
     *
     * <p>仅列举当前版本，不执行逐对象 HEAD；SDK 重试同样受单次调用总超时约束。</p>
     * @param continuationToken 上一页游标；首页为 null
     * @return 对象元数据页
     * @throws RuntimeException 访问失败或分页响应不完整时抛出
     */
    @Override
    public FileObjectPage listObjects(String continuationToken) {
        ListObjectsV2Request request = ListObjectsV2Request.builder()
                .bucket(config.getBucket())
                .maxKeys(1000)
                .continuationToken(continuationToken)
                .overrideConfiguration(builder -> builder.apiCallTimeout(Duration.ofSeconds(3))
                        .apiCallAttemptTimeout(Duration.ofSeconds(2)))
                .build();
        ListObjectsV2Response response = client.listObjectsV2(request);
        String nextToken = Boolean.TRUE.equals(response.isTruncated()) ? response.nextContinuationToken() : null;
        // 分页标记矛盾时不能把首批数据冒充全量，也不能用重复游标重复累计。
        if (Boolean.TRUE.equals(response.isTruncated())
                && (nextToken == null || nextToken.isBlank() || nextToken.equals(continuationToken))) {
            throw new IllegalStateException("对象存储返回无效分页游标");
        }
        List<FileObjectPage.Entry> objects = new ArrayList<>();
        for (S3Object object : response.contents()) {
            if (object.key() == null || object.size() == null || object.size() < 0) {
                throw new IllegalStateException("对象存储返回无效容量元数据");
            }
            objects.add(new FileObjectPage.Entry(object.key(), object.size()));
        }
        return new FileObjectPage(List.copyOf(objects), nextToken);
    }

    /**
     * 创建 S3 文件客户端。
     *
     * @param id 进程内客户端标识
     * @param config S3 客户端配置
     */
    public S3FileClient(Long id, S3FileClientConfig config) {
        super(id, config);
    }

    /**
     * 创建或刷新 S3 SDK 客户端，并在替换成功后关闭旧连接资源。
     */
    @Override
    protected void doInit() {
        // 补全 domain
        if (StrUtil.isEmpty(config.getDomain())) {
            config.setDomain(buildDomain());
        }
        // 初始化 S3 客户端
        // 优先级：配置的 region > 从 endpoint 解析的 region > 默认值 us-east-1
        String regionStr = resolveRegion();
        Region region = Region.of(regionStr);
        AwsCredentialsProvider credentialsProvider = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(config.getAccessKey(), config.getAccessSecret()));
        URI endpoint = URI.create(buildEndpoint());
        S3Configuration serviceConfiguration = S3Configuration.builder() // Path-style 访问
                .pathStyleAccessEnabled(Boolean.TRUE.equals(config.getEnablePathStyleAccess()))
                .chunkedEncodingEnabled(false) // 禁用分块编码，避免部分兼容实现上传失败
                .build();
        S3Client newClient = S3Client.builder()
                .credentialsProvider(credentialsProvider)
                .region(region)
                .endpointOverride(endpoint)
                .serviceConfiguration(serviceConfiguration)
                .overrideConfiguration(builder -> builder.apiCallTimeout(Duration.ofSeconds(30))
                        .apiCallAttemptTimeout(Duration.ofSeconds(10)))
                .build();
        try {
            S3Presigner newPresigner = S3Presigner.builder()
                    .credentialsProvider(credentialsProvider)
                    .region(region)
                    .endpointOverride(endpoint)
                    .serviceConfiguration(serviceConfiguration)
                    .build();
            closeCurrentClients();
            client = newClient;
            presigner = newPresigner;
        } catch (RuntimeException ex) {
            newClient.close();
            throw ex;
        }
    }

    /**
     * 关闭当前 S3 访问客户端和预签名客户端。
     */
    @Override
    public void close() {
        closeCurrentClients();
        client = null;
        presigner = null;
    }

    /**
     * 关闭当前已创建的 SDK 资源，供刷新和应用关闭复用。
     */
    private void closeCurrentClients() {
        if (client != null) {
            client.close();
        }
        if (presigner != null) {
            presigner.close();
        }
    }

    /**
     * 上传字节内容到指定对象路径。
     *
     * @param content 文件内容
     * @param path 对象路径
     * @param type MIME 类型
     * @return 文件访问地址
     */
    @Override
    public String upload(byte[] content, String path, String type) {
        // 构造 PutObjectRequest
        PutObjectRequest putRequest = PutObjectRequest.builder()
                .bucket(config.getBucket())
                .key(path)
                .contentType(type)
                .contentDisposition(type != null && type.startsWith("image/") ? "inline" : "attachment")
                .contentLength((long) content.length)
                .build();
        // 上传文件
        client.putObject(putRequest, RequestBody.fromBytes(content));
        // 拼接返回路径
        return presignGetUrl(path, null);
    }

    /**
     * 删除指定对象。
     *
     * @param path 对象路径
     */
    @Override
    public void delete(String path) {
        DeleteObjectRequest deleteRequest = DeleteObjectRequest.builder()
                .bucket(config.getBucket())
                .key(path)
                .build();
        client.deleteObject(deleteRequest);
    }

    /**
     * 读取普通下载内容，使用 32 MiB 上限避免无界堆分配；更大文件应使用流式交付。
     * @param path 对象路径
     * @return 文件字节内容
     * @throws IOException 对象超限或读取失败
     */
    @Override
    public byte[] getContent(String path) throws IOException {
        return getContent(path, 32 * 1024 * 1024);
    }

    /**
     * 根据响应长度及实际读取双重限制下载大小，并在所有结果下关闭响应流。
     * @param path 对象路径
     * @param maximumBytes 最大字节数，1 至 32 MiB
     * @return 未超过上限的完整内容
     * @throws IOException 响应声明或实际内容超过上限、读取失败
     */
    @Override
    public byte[] getContent(String path, int maximumBytes) throws IOException {
        if (maximumBytes < 1 || maximumBytes > 32 * 1024 * 1024) {
            throw new IllegalArgumentException("文件读取上限必须在 1 至 32 MiB 之间");
        }
        GetObjectRequest getRequest = GetObjectRequest.builder()
                .bucket(config.getBucket()).key(path).build();
        try (ResponseInputStream<GetObjectResponse> inputStream = client.getObject(getRequest)) {
            Long declared = inputStream.response().contentLength();
            if (declared != null && declared > maximumBytes) {
                inputStream.abort();
                throw new IOException("对象大小超过预约上限");
            }
            byte[] content = inputStream.readNBytes(maximumBytes + 1);
            if (content.length > maximumBytes) {
                inputStream.abort();
                throw new IOException("对象实际内容超过预约上限");
            }
            return content;
        }
    }

    /**
     * 通过 S3 服务端复制对象，避免业务图片复制依赖公网 URL。
     *
     * @param sourcePath 来源对象路径
     * @param targetPath 目标对象路径
     * @param type 文件类型
     * @return 目标对象访问 URL
     */
    @Override
    public String copy(String sourcePath, String targetPath, String type) {
        CopyObjectRequest copyRequest = CopyObjectRequest.builder()
                .sourceBucket(config.getBucket())
                .sourceKey(sourcePath)
                .destinationBucket(config.getBucket())
                .destinationKey(targetPath)
                .contentType(type)
                .build();
        client.copyObject(copyRequest);
        return presignGetUrl(targetPath, null);
    }

    /**
     * 查询 S3 路径下的一级子目录前缀。
     *
     * @param prefix 路径前缀
     * @param delimiter 分隔符
     * @return 子目录前缀列表
     */
    @Override
    public List<String> listPrefixes(String prefix, String delimiter) {
        List<String> prefixes = new ArrayList<>();
        String continuationToken = null;
        do {
            ListObjectsV2Request.Builder requestBuilder = ListObjectsV2Request.builder()
                    .bucket(config.getBucket())
                    .prefix(prefix);
            if (StrUtil.isNotEmpty(delimiter)) {
                requestBuilder.delimiter(delimiter);
            }
            if (continuationToken != null) {
                requestBuilder.continuationToken(continuationToken);
            }
            ListObjectsV2Response response = client.listObjectsV2(requestBuilder.build());
            for (CommonPrefix commonPrefix : response.commonPrefixes()) {
                prefixes.add(commonPrefix.prefix());
            }
            continuationToken = response.nextContinuationToken();
        } while (continuationToken != null);
        return prefixes;
    }

    /**
     * 删除 S3 路径前缀下的全部对象。
     *
     * @param prefix 路径前缀
     * @return 删除的对象数量
     */
    @Override
    public int deletePrefix(String prefix) {
        int deleted = 0;
        String continuationToken = null;
        do {
            ListObjectsV2Request.Builder requestBuilder = ListObjectsV2Request.builder()
                    .bucket(config.getBucket())
                    .prefix(prefix);
            if (continuationToken != null) {
                requestBuilder.continuationToken(continuationToken);
            }
            ListObjectsV2Response response = client.listObjectsV2(requestBuilder.build());
            for (S3Object object : response.contents()) {
                delete(object.key());
                deleted++;
            }
            continuationToken = response.nextContinuationToken();
        } while (continuationToken != null);
        return deleted;
    }

    /**
     * 生成五分钟上传地址，绑定大小和下载为附件的元数据，暂存内容不以内联页面展示。
     *
     * @param path 对象路径
     * @param size 签名绑定的精确字节数
     * @return 上传预签名地址
     */
    @Override
    public String presignPutUrl(String path, long size) {
        if (size < 1 || size > 32 * 1024 * 1024) {
            throw new IllegalArgumentException("上传大小必须在 1 至 32 MiB 之间");
        }
        return presigner.presignPutObject(PutObjectPresignRequest.builder()
                .signatureDuration(Duration.ofMinutes(5))
                .putObjectRequest(b -> b.bucket(config.getBucket()).key(path)
                        .contentLength(size).contentType("application/octet-stream")
                        .contentDisposition("attachment")).build())
                .url().toString();
    }

    /**
     * 生成对象读取地址；公开桶返回稳定 URL，私有桶返回限时预签名 URL。
     *
     * @param url 对象路径或完整文件地址
     * @param expirationSeconds 私有桶签名有效期，单位秒；为空时使用 24 小时
     * @return 对象读取地址
     */
    @Override
    public String presignGetUrl(String url, Integer expirationSeconds) {
        // 1. 将 url 转换为 path
        String path = StrUtil.removePrefix(url, config.getDomain() + "/");
        path = HttpUtils.decodeUtf8(HttpUtils.removeUrlQuery(path));

        // 2.1 情况一：公开访问：无需签名
        // 考虑到老版本的兼容，所以必须是 config.getEnablePublicAccess() 为 false 时，才进行签名
        if (!BooleanUtil.isFalse(config.getEnablePublicAccess())) {
            return config.getDomain() + "/" + path;
        }

        // 2.2 情况二：私有访问：生成 GET 预签名 URL
        String finalPath = path;
        Duration expiration = expirationSeconds != null ? Duration.ofSeconds(expirationSeconds) : EXPIRATION_DEFAULT;
        URL signedUrl = presigner.presignGetObject(GetObjectPresignRequest.builder()
                .signatureDuration(expiration)
                .getObjectRequest(b -> b.bucket(config.getBucket()).key(finalPath)).build())
                .url();
        return signedUrl.toString();
    }

    /**
     * 基于 bucket + endpoint 构建访问的 Domain 地址
     *
     * @return Domain 地址
     */
    private String buildDomain() {
        // 如果已经是 http 或者 https，则不进行拼接.主要适配 MinIO
        if (HttpUtil.isHttp(config.getEndpoint()) || HttpUtil.isHttps(config.getEndpoint())) {
            return StrUtil.format("{}/{}", config.getEndpoint(), config.getBucket());
        }
        // 阿里云、腾讯云、华为云都适合。七牛云比较特殊，必须有自定义域名
        return StrUtil.format("https://{}.{}", config.getBucket(), config.getEndpoint());
    }

    /**
     * 节点地址补全协议头
     *
     * @return 节点地址
     */
    private String buildEndpoint() {
        // 如果已经是 http 或者 https，则不进行拼接
        if (HttpUtil.isHttp(config.getEndpoint()) || HttpUtil.isHttps(config.getEndpoint())) {
            return config.getEndpoint();
        }
        return StrUtil.format("https://{}", config.getEndpoint());
    }

    /**
     * 解析 AWS 区域
     * 优先级：配置的 region > 从 endpoint 解析的 region > 默认值 us-east-1
     *
     * @return 区域字符串
     */
    private String resolveRegion() {
        // 1. 如果配置了 region，直接使用
        if (StrUtil.isNotEmpty(config.getRegion())) {
            return config.getRegion();
        }

        // 2.1 尝试从 endpoint 中解析 region
        String endpoint = config.getEndpoint();
        if (StrUtil.isEmpty(endpoint)) {
            return "us-east-1";
        }

        // 2.2 移除协议头（http:// 或 https://）
        String host = endpoint;
        if (HttpUtil.isHttp(endpoint) || HttpUtil.isHttps(endpoint)) {
            try {
                host = URI.create(endpoint).getHost();
            } catch (IllegalArgumentException ex) {
                // 解析失败，使用默认值
                return "us-east-1";
            }
        }
        if (StrUtil.isEmpty(host)) {
            return "us-east-1";
        }

        // 3.1 AWS S3 格式：s3.us-west-2.amazonaws.com 或 s3.amazonaws.com
        if (host.contains("amazonaws.com")) {
            // 匹配 s3.{region}.amazonaws.com 格式
            if (host.startsWith("s3.") && host.contains(".amazonaws.com")) {
                String regionPart = host.substring(3, host.indexOf(".amazonaws.com"));
                if (StrUtil.isNotEmpty(regionPart) && !regionPart.equals("accelerate")) {
                    return regionPart;
                }
            }
            // s3.amazonaws.com 或 s3-accelerate.amazonaws.com 使用默认值
            return "us-east-1";
        }
        // 3.2 阿里云 OSS 格式：oss-cn-beijing.aliyuncs.com
        // 匹配 oss-{region}.aliyuncs.com 格式；其他阿里云域名继续使用默认区域。
        if (host.contains(S3FileClientConfig.ENDPOINT_ALIYUN)
                && host.startsWith("oss-")
                && host.contains("." + S3FileClientConfig.ENDPOINT_ALIYUN)) {
            String regionPart = host.substring(4, host.indexOf("." + S3FileClientConfig.ENDPOINT_ALIYUN));
            if (StrUtil.isNotEmpty(regionPart)) {
                return regionPart;
            }
        }
        // 3.3 腾讯云 COS 格式：cos.ap-shanghai.myqcloud.com
        // 匹配 cos.{region}.myqcloud.com 格式；其他腾讯云域名继续使用默认区域。
        if (host.contains(S3FileClientConfig.ENDPOINT_TENCENT)
                && host.startsWith("cos.")
                && host.contains("." + S3FileClientConfig.ENDPOINT_TENCENT)) {
            String regionPart = host.substring(4, host.indexOf("." + S3FileClientConfig.ENDPOINT_TENCENT));
            if (StrUtil.isNotEmpty(regionPart)) {
                return regionPart;
            }
        }

        // 3.4 其他情况（MinIO、七牛云等）使用默认值
        return "us-east-1";
    }

}
