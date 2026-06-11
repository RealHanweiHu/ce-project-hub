# 部署指南（自托管 beepump.io）

本项目已完全脱离 Manus 平台：PostgreSQL + S3 兼容对象存储（MinIO 或阿里云 OSS）+ 本地账号密码登录，可部署在任何一台装有 Docker 的服务器上。

## 架构

```
浏览器 ── HTTPS ──> Caddy/Nginx (443) ──> app (Node, :3000)
                                            ├─> PostgreSQL（compose 内置 db 或阿里云 RDS）
                                            └─> MinIO（compose 内置）或阿里云 OSS
```

## 一、服务器准备

- 一台云服务器（可与 ERP 看板同机），安装 Docker + Docker Compose 插件。
- 放行 80/443 端口。

## 二、部署应用

```bash
# 1. 上传代码（git clone 或 rsync 本目录到服务器）
cd ce-project-hub

# 2. 准备环境变量
cp .env.example .env
# 编辑 .env：
#   - JWT_SECRET 换成随机串：openssl rand -base64 32
#   - 用 RDS 时改 DATABASE_URL 并删除 compose 中的 db 服务
#   - 用 OSS 时改 S3_* 并删除 compose 中的 minio 服务

# 3. 启动
docker compose up -d --build

# 4. 应用数据库迁移（首次/每次 schema 变更后）
docker compose run --rm app sh -c "npx drizzle-kit migrate"

# 5. 创建 MinIO bucket（仅用内置 MinIO 时需要，首次一次）
docker compose exec minio mkdir -p /data/cehub
```

## 三、初始化管理员

数据库为空时，访问一次性初始化接口创建第一个管理员（之后接口自动关闭）：

```bash
curl -X POST http://localhost:3000/api/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<强密码>","name":"管理员"}'
```

之后其他成员通过登录页自助注册，由管理员在「系统管理」面板授权。

## 四、HTTPS 与域名切换

推荐 Caddy（自动申请/续期 Let's Encrypt 证书）。`/etc/caddy/Caddyfile`：

```
beepump.io {
    reverse_proxy localhost:3000
}
```

```bash
docker run -d --name caddy --restart unless-stopped \
  --network host \
  -v /etc/caddy/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data \
  caddy:2
```

DNS 切换（在域名注册商处）：

1. 先用临时子域（如 `hub.beepump.io` A 记录 → 服务器 IP）试运行，验证注册/登录/建项目/传文件。
2. 确认无误后，把 `beepump.io` 的 A 记录从 Manus 改指到服务器 IP。
3. Manus 上的旧实例保留几天作为回退，确认稳定后停掉。

## 五、使用阿里云 RDS / OSS（可选）

- **RDS PostgreSQL**：`DATABASE_URL=postgres://user:pass@pgm-xxxx.pg.rds.aliyuncs.com:5432/cehub`，并在 RDS 白名单中放行服务器 IP；compose 中删除 `db` 服务。
- **OSS**：开通 S3 兼容访问，`S3_ENDPOINT` 用**内网** endpoint（应用与 OSS 同地域时，如 `https://oss-cn-shenzhen-internal.aliyuncs.com`），`S3_FORCE_PATH_STYLE=false`；compose 中删除 `minio` 服务。

## 六、备份

```bash
# 数据库（建议 cron 每日执行）
docker compose exec db pg_dump -U postgres cehub | gzip > backup_$(date +%F).sql.gz

# MinIO 文件
docker run --rm -v ce-project-hub_miniodata:/data -v $(pwd):/backup alpine \
  tar czf /backup/minio_$(date +%F).tar.gz /data
```

使用 RDS/OSS 时直接用云厂商的自动备份功能。
