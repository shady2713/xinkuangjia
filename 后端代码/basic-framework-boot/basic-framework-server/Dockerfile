# 基于 Eclipse Temurin 17 JRE（与 Maven target=17 对齐）构建轻量非 root 运行时镜像
FROM eclipse-temurin:17-jre-alpine

# 创建独立非特权运行用户并预建日志挂载目录，确保命名卷默认归属 appuser
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && mkdir -p /basic-framework-server/logs \
    && chown -R appuser:appgroup /basic-framework-server

WORKDIR /basic-framework-server
COPY --chown=appuser:appgroup ./target/basic-framework-server.jar app.jar

ENV TZ=Asia/Shanghai
# 按容器 cgroup 内存限额动态伸缩堆上限，可通过 docker run -e "JAVA_OPTS=" 覆盖
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -Djava.security.egd=file:/dev/./urandom"
ENV ARGS=""

USER appuser
EXPOSE 48080

# 使用 exec 形式确保 PID 1 直接接收 SIGTERM，支持 Spring Boot 优雅停机
ENTRYPOINT ["sh", "-c", "exec java ${JAVA_OPTS} -jar app.jar ${ARGS}"]
