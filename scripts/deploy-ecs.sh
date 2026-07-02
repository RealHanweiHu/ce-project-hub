#!/usr/bin/env bash
# 一键部署到阿里云 ECS（与 ERP 看板同机）。
# 在本机项目根目录执行：bash scripts/deploy-ecs.sh
set -euo pipefail

ECS_USER=${ECS_USER:-root}
ECS_HOST=${ECS_HOST:-8.140.197.68}
ECS_PORT=${ECS_PORT:-22}
DIR=${ECS_DIR:-/opt/ce-project-hub}
ECS="$ECS_USER@$ECS_HOST"
SSH_COMMON=(-o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2)
SSH_CMD=(ssh -p "$ECS_PORT" "${SSH_COMMON[@]}" "$ECS")

echo "==> 检查 SSH 连接 $ECS:$ECS_PORT"
if ! "${SSH_CMD[@]}" "mkdir -p '$DIR'"; then
  cat <<EOF
无法通过 SSH 连接到 $ECS:$ECS_PORT，部署尚未开始。

请先在 ECS 控制台/Workbench 检查：
  - 安全组是否放行本机出口 IP 到 $ECS_PORT 端口
  - sshd 是否正在运行，且没有被 fail2ban/sshguard 拦截
  - root 登录是否仍允许，或部署用户/端口是否已变更

如果 SSH 参数已变更，可这样重试：
  ECS_HOST=8.140.197.68 ECS_USER=root ECS_PORT=22 bash scripts/deploy-ecs.sh
EOF
  exit 1
fi

echo "==> 同步代码到 $ECS:$DIR"
rsync -az --delete \
  -e "ssh -p $ECS_PORT -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2" \
  --exclude node_modules --exclude .git --exclude dist \
  --exclude .manus-logs --exclude .env \
  --exclude .playwright-cli --exclude output --exclude task_plan.md \
  ./ "$ECS:$DIR/"

echo "==> 写入生产 .env"
scp -q -P "$ECS_PORT" "${SSH_COMMON[@]}" .env.production "$ECS:$DIR/.env"

echo "==> 构建并启动（app + minio，数据库用 RDS）"
"${SSH_CMD[@]}" "cd $DIR && docker compose -f docker-compose.prod.yml up -d --build"

echo "==> 应用数据库迁移（drizzle-orm migrator，幂等；prod 镜像不含 drizzle-kit 故走 runtime migrator）"
MIGRATE_JS='const{drizzle}=require("drizzle-orm/node-postgres");const{migrate}=require("drizzle-orm/node-postgres/migrator");const{Pool}=require("pg");const p=new Pool({connectionString:process.env.DATABASE_URL});migrate(drizzle(p),{migrationsFolder:"./drizzle"}).then(()=>{console.log("migrated OK");return p.end()}).catch(e=>{console.error("MIGRATE_ERR",e.message);process.exit(1)})'
MIGRATE_B64=$(printf '%s' "$MIGRATE_JS" | base64 | tr -d '\n')
"${SSH_CMD[@]}" "cd $DIR && docker compose -f docker-compose.prod.yml run --rm -T app sh -c 'echo $MIGRATE_B64 | base64 -d | node -'"

# MinIO bucket 由应用启动时自动创建（server/storage.ts ensureBucket），无需手动 mkdir。

echo "==> 烟雾测试"
"${SSH_CMD[@]}" 'sleep 3; curl -s -o /dev/null -w "app http: %{http_code}\n" http://localhost:3001/ && curl -s http://localhost:3001/api/setup/status && echo'

echo "==> 完成。下一步："
echo "   1) 创建首个管理员："
echo "      ssh $ECS 'curl -s -X POST http://localhost:3001/api/setup -H \"Content-Type: application/json\" -d \"{\\\"username\\\":\\\"admin\\\",\\\"password\\\":\\\"<强密码>\\\",\\\"name\\\":\\\"管理员\\\"}\"'"
echo "   2) 在 ERP 的 nginx 中为 beepump.io 加反代到 127.0.0.1:3001，配证书"
echo "   3) 域名注册商处把 beepump.io A 记录改指 8.140.197.68"
