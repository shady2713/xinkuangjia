# 使用官方非 root Nginx 镜像，默认以 uid 101 运行并监听 8080 端口
FROM nginxinc/nginx-unprivileged:1.27-alpine

WORKDIR /usr/share/nginx/html

# 先复制前端构建产物，再覆盖运行时配置和 nginx 代理配置（保持 root 只读属主，防止非特权进程篡改）。
COPY dist/ /usr/share/nginx/html/
COPY docker/app.config.js /usr/share/nginx/html/_app.config.js
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
