FROM nginx:1.27-alpine

# 删除默认站点，避免 nginx 默认页面覆盖新管理平台前端。
RUN rm -f /etc/nginx/conf.d/default.conf

WORKDIR /usr/share/nginx/html

# 先复制前端构建产物，再覆盖运行时配置和 nginx 代理配置。
COPY dist/ /usr/share/nginx/html/
COPY docker/app.config.js /usr/share/nginx/html/_app.config.js
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
