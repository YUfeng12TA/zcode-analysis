#!/usr/bin/env bash
# 用法:  GH_TOKEN=ghp_xxx REPO_OWNER=youruser REPO_NAME=zcode-analysis ./push.sh
set -e
: "${GH_TOKEN:?需设 GH_TOKEN}"; : "${REPO_OWNER:?需设 REPO_OWNER}"; : "${REPO_NAME:?=zcode-analysis}"
# 走本机 v2rayN 代理(git 已配 http.proxy=127.0.0.1:10808, 全局生效)
remote="https://x-access-token:${GH_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME}.git"
cd "$(dirname "$0")"
# 先确认远端仓库存在(否则 404/409)
git ls-remote "$remote" >/dev/null 2>&1 && echo "远端可达" || { echo "远端不可达: 仓库需先存在(或 API 创建)。检查 REPO_OWNER/NAME 与 token 权限"; exit 1; }
git remote set-url origin "$remote"
git push -u origin main
echo "已推送。"
