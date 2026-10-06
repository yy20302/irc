#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:-roblox-irc-api}"

echo "==> 初始化 git 仓库"
if [ ! -d .git ]; then
  git init
fi

git add .
git commit -m "deploy: Roblox IRC API" || true

if [ -z "$(git remote)" ]; then
  echo "请先把仓库创建在 GitHub 上，然后设置 remote。"
  echo "你可以先执行:"
  echo "  git remote add origin git@github.com:你的用户名/${REPO_NAME}.git"
  exit 1
fi

git push

echo "==> 代码已推送到 GitHub"
echo
echo "接下来到 Render 部署:"
echo "1. New + -> Web Service"
echo "2. 连接你的 GitHub 仓库"
echo "3. Build Command: npm install"
echo "4. Start Command: npm start"
echo "5. 环境变量先设 ENABLE_IRC=false"
echo "6. 部署后访问 https://你的服务名.onrender.com/"
