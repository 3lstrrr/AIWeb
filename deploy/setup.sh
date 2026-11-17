#!/usr/bin/env bash
# 一键部署脚本（Ubuntu 22.04 / 腾讯云 CVM 或 轻量均可）
# 用法：
#   bash deploy/setup.sh 你的域名 [证书通知邮箱]
# 做的事：装 Node 20 与 Nginx → 拉代码 → 写/校验 .env.local → 构建 → PM2 常驻 → Nginx 反代 → Let's Encrypt 证书
# 说明：本脚本未经实机验证（开发机为 Windows），首次执行请逐段观察输出。

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" ]]; then
  echo "用法: bash deploy/setup.sh <你的域名> [邮箱]"
  exit 1
fi

APP_DIR="/opt/zhixue"
REPO="git@github.com:3lstrrr/AIWeb.git"

echo "==> 1/6 安装运行时"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get install -y nginx git

echo "==> 2/6 拉取代码"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
git pull --ff-only || echo "（跳过 git pull：可能存在本地改动）"

echo "==> 3/6 检查环境变量"
if [ ! -f .env.local ]; then
  cat > .env.local <<'ENVEOF'
ZHIPU_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=
ENVEOF
  chmod 600 .env.local
  echo "已生成 .env.local，请填写前三个变量后重新运行本脚本。"
  exit 0
fi

# NEXT_PUBLIC_* 是构建期内联，必须在 npm run build 之前写对
sed -i "s|^NEXT_PUBLIC_SITE_URL=.*|NEXT_PUBLIC_SITE_URL=https://${DOMAIN}|" .env.local
chmod 600 .env.local

echo "==> 4/6 构建并启动"
npm ci
npm run build
sudo npm install -g pm2
pm2 delete zhixue >/dev/null 2>&1 || true
PORT=3000 pm2 start "npm run start" --name zhixue --max-memory-restart 700M
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | bash || echo "（pm2 startup 跳过，可手动执行上一条输出）"

echo "==> 5/6 配置 Nginx"
sudo cp deploy/nginx.conf /etc/nginx/conf.d/zhixue.conf
sudo sed -i "s|your-domain.com|${DOMAIN}|g" /etc/nginx/conf.d/zhixue.conf
sudo nginx -t
sudo systemctl reload nginx

echo "==> 6/6 申请 HTTPS 证书"
sudo apt-get install -y certbot python3-certbot-nginx
if [[ -n "$EMAIL" ]]; then
  sudo certbot --nginx -d "$DOMAIN" --agree-tos -m "$EMAIL" --redirect -n
else
  sudo certbot --nginx -d "$DOMAIN" --agree-tos --register-unsafely-without-email --redirect -n
fi

echo "✅ 完成：https://${DOMAIN}"
echo "   查看日志：pm2 logs zhixue"
echo "   重启服务：pm2 restart zhixue"
