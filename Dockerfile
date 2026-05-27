FROM nginx:alpine
RUN rm -rf /usr/share/nginx/index/*
COPY . /usr/share/nginx/index