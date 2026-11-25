package com.basicframework.module.infra.framework.file.core.client.local;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.infra.framework.file.core.client.AbstractFileClient;
import com.basicframework.module.infra.framework.file.core.client.FileContentStream;
import com.basicframework.module.infra.framework.file.core.client.FileObjectStat;
import com.basicframework.module.infra.framework.file.core.utils.FilePathUtils;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_METADATA_INVALID;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_PRIVATE_SIGNING_UNSUPPORTED;

/**
 * 极简本地磁盘文件客户端，供本地开发、CI 及断网政务内网兜底使用。
 *
 * <p>所有对象路径均强制规范化并校验必须落在 {@code basePath} 目录内，严防目录穿越。</p>
 *
 * @author shady
 */
public class LocalFileClient extends AbstractFileClient<LocalFileClientConfig> {

    private Path rootDir;

    public LocalFileClient(Long id, LocalFileClientConfig config) {
        super(id, config);
    }

    @Override
    protected void doInit() {
        String configuredPath = StrUtil.blankToDefault(config.getBasePath(), "./.local-storage");
        this.rootDir = Path.of(configuredPath).toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.rootDir);
        } catch (IOException ex) {
            throw new IllegalStateException("无法初始化本地文件存储目录: " + this.rootDir, ex);
        }
    }

    @Override
    public String upload(byte[] content, String path, String type) throws Exception {
        Path target = resolveSafePath(path);
        String url = formatFileUrl(StrUtil.removeSuffix(config.getDomain(), "/"), path);
        if (config.isPublicAccess() && !FilePathUtils.isPrivateObjectPath(path) && !FilePathUtils.isFileUrlValid(url)) {
            throw new ServiceException(FILE_METADATA_INVALID);
        }
        Path parent = target.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.write(target, content, StandardOpenOption.CREATE_NEW);
        return url;
    }

    @Override
    public void delete(String path) throws Exception {
        Files.deleteIfExists(resolveSafePath(path));
    }

    @Override
    public byte[] getContent(String path) throws Exception {
        Path target = resolveSafePath(path);
        if (!Files.isRegularFile(target)) {
            return null;
        }
        return Files.readAllBytes(target);
    }

    @Override
    public InputStream openContentStream(String path) throws Exception {
        Path target = resolveSafePath(path);
        if (!Files.isRegularFile(target)) {
            return null;
        }
        return Files.newInputStream(target);
    }

    @Override
    public FileContentStream openContent(String path) throws Exception {
        Path target = resolveSafePath(path);
        if (!Files.isRegularFile(target)) {
            return null;
        }
        return new FileContentStream(Files.newInputStream(target), Files.size(target));
    }

    @Override
    public FileObjectStat statObject(String path) {
        try {
            Path target = resolveSafePath(path);
            if (!Files.isRegularFile(target)) {
                return null;
            }
            return new FileObjectStat(Files.size(target), Files.probeContentType(target));
        } catch (IOException ex) {
            throw new IllegalStateException("读取本地文件元数据失败: " + path, ex);
        }
    }

    @Override
    public String presignPrivateGetUrl(String path, Integer expirationSeconds) {
        // Local storage has no signer; private reads use the authorized /infra/file/private/content route.
        throw new ServiceException(FILE_PRIVATE_SIGNING_UNSUPPORTED);
    }

    private Path resolveSafePath(String path) {
        if (StrUtil.isBlank(path)) {
            throw new IllegalArgumentException("文件路径不能为空");
        }
        String normalizedRelative = StrUtil.removePrefix(path.replace('\\', '/'), "/");
        Path resolved = rootDir.resolve(normalizedRelative).normalize();
        if (!resolved.startsWith(rootDir) || resolved.equals(rootDir)) {
            throw new IllegalArgumentException("非法文件路径，禁止目录穿越: " + path);
        }
        return resolved;
    }

}
