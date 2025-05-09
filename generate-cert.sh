#!/bin/bash

# 创建证书目录
mkdir -p certs

# 生成私钥和证书
openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"

echo "证书已生成在 certs 目录中" 