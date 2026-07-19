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

echo "==> 检查 SSH 连接 ${ECS}:${ECS_PORT}"
if ! "${SSH_CMD[@]}" "mkdir -p '$DIR'"; then
  cat <<EOF
无法通过 SSH 连接到 ${ECS}:${ECS_PORT}，部署尚未开始。

请先在 ECS 控制台/Workbench 检查：
  - 安全组是否放行本机出口 IP 到 ${ECS_PORT} 端口
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
  --exclude .audit --exclude .worktrees --exclude outputs \
  --exclude .manus-logs --exclude .env --exclude .env.production \
  --exclude .playwright-cli --exclude output --exclude scripts/__pycache__ \
  --exclude task_plan.md \
  ./ "$ECS:$DIR/"

echo "==> 写入生产 .env"
scp -q -P "$ECS_PORT" "${SSH_COMMON[@]}" .env.production "$ECS:$DIR/.env"

echo "==> 保存当前应用镜像（供失败回滚）"
"${SSH_CMD[@]}" "if docker image inspect ce-project-hub-app:current >/dev/null 2>&1; then docker tag ce-project-hub-app:current ce-project-hub-app:rollback; fi"

echo "==> 预构建新应用镜像（旧应用继续服务）"
"${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml build app"

echo "==> 确保 MinIO 已运行（不重建应用）"
"${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml up -d minio"

echo "==> 进入短维护窗口：停止旧应用"
"${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml stop app"

echo "==> 预提交需跨事务生效的枚举值（兼容已存在数据库；全新数据库安全跳过）"
ENUM_PREP_JS='const{Pool}=require("pg");const p=new Pool({connectionString:process.env.DATABASE_URL});const q="DO $block$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname = $enum$action_item_kind$enum$) THEN ALTER TYPE action_item_kind ADD VALUE IF NOT EXISTS $enum$condition_followup$enum$; END IF; END $block$;";p.query(q).then(()=>{console.log("enum precommit OK");return p.end()}).catch(e=>{console.error("ENUM_PRECOMMIT_ERR",e.code||"",e.message);process.exit(1)})'
ENUM_PREP_B64=$(printf '%s' "$ENUM_PREP_JS" | base64 | tr -d '\n')
if ! "${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml run --rm -T --no-deps app sh -c 'echo $ENUM_PREP_B64 | base64 -d | node -'"; then
  echo "枚举预提交失败；恢复旧容器并终止部署。"
  "${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml start app" || true
  exit 1
fi

echo "==> 应用数据库迁移（drizzle-orm migrator，幂等；prod 镜像不含 drizzle-kit 故走 runtime migrator）"
MIGRATE_JS='const{drizzle}=require("drizzle-orm/node-postgres");const{migrate}=require("drizzle-orm/node-postgres/migrator");const{Pool}=require("pg");const p=new Pool({connectionString:process.env.DATABASE_URL});migrate(drizzle(p),{migrationsFolder:"./drizzle"}).then(()=>{console.log("migrated OK");return p.end()}).catch(e=>{console.error("MIGRATE_ERR",e.message);process.exit(1)})'
MIGRATE_B64=$(printf '%s' "$MIGRATE_JS" | base64 | tr -d '\n')
if ! "${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml run --rm -T --no-deps app sh -c 'echo $MIGRATE_B64 | base64 -d | node -'"; then
  echo "数据库迁移失败；恢复旧容器并终止部署。"
  "${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml start app" || true
  exit 1
fi

echo "==> 启动新应用"
"${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml up -d --no-deps app"

# MinIO bucket 由应用启动时自动创建（server/storage.ts ensureBucket），无需手动 mkdir。

echo "==> 严格烟雾测试（HTTP、数据库、MinIO）"
if ! "${SSH_CMD[@]}" "for attempt in \$(seq 1 30); do if curl -fsS http://localhost:3001/ >/dev/null; then exit 0; fi; sleep 2; done; exit 1"; then
  echo "应用首页在 60 秒内未就绪。"
  "${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml logs --tail=120 app" || true
  if "${SSH_CMD[@]}" "docker image inspect ce-project-hub-app:rollback >/dev/null 2>&1"; then
    echo "==> 回滚到上一应用镜像"
    "${SSH_CMD[@]}" "docker tag ce-project-hub-app:rollback ce-project-hub-app:current && cd '$DIR' && docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate app"
  fi
  exit 1
fi

SMOKE_JS='async function main(){const app=await fetch("http://127.0.0.1:3000/api/setup/status");if(!app.ok)throw new Error(`setup status HTTP ${app.status}`);const body=await app.json();if(typeof body.needsSetup!=="boolean")throw new Error("invalid setup status payload");const storage=await fetch("http://minio:9000/minio/health/live");if(!storage.ok)throw new Error(`minio HTTP ${storage.status}`);console.log("setup",JSON.stringify(body),"minio",storage.status)}main().catch(error=>{console.error("SMOKE_ERR",error.message);process.exit(1)})'
SMOKE_B64=$(printf '%s' "$SMOKE_JS" | base64 | tr -d '\n')
if ! "${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml exec -T app sh -c 'echo $SMOKE_B64 | base64 -d | node -'"; then
  echo "数据库或 MinIO 烟测失败。"
  "${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml logs --tail=120 app minio" || true
  exit 1
fi
"${SSH_CMD[@]}" "cd '$DIR' && docker compose -f docker-compose.prod.yml ps"

echo "==> 完成。下一步："
echo "   1) 内网检查：http://localhost:3001/"
echo "   2) 公网检查：https://hub.beepump.net/"
