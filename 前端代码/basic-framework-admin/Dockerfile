# 非特权 Nginx 容器，默认 uid 101 监听 8080 端口
FROM nginxinc/nginx-unprivileged:1.31-alpine

WORKDIR /usr/share/nginx/html

COPY dist/ /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
