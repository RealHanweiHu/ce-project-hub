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

## 五、使用阿里云 RDS / OSS（本项目实际方案）

实际部署目标与 erp-management-dashboard（beepump.net）**同一套基础设施**，真实参数已写入 `.env.production`（不入库）：

| 项 | 值 |
|---|---|
| ECS 公网 IP | 8.140.197.68（Ubuntu 22.04，已装 Docker，跑着 ERP 看板） |
| ECS 内网 IP | 172.19.142.146（已在 RDS 白名单） |
| RDS 实例 | pgm-2ze135h6045td5ujvo.pg.rds.aliyuncs.com:5432（PostgreSQL，与 ERP 共用实例） |
| 本看板数据库 | `cehub`（独立数据库，与 erp_dashboard 隔离） |
| RDS 账号 | `ce_hub`（本看板专用账号，与 ERP 的账号分离） |
| RDS CA 证书 | 已随仓库携带：`certs/ApsaraDB-CA-Chain.pem`（公开 CA 链，compose 已挂载到容器 `/app/certs/`） |

使用 RDS 的步骤：

1. **创建账号与数据库**（一次性，RDS 控制台「账号管理」创建高权限/普通账号 `ce_hub`，或用已有高权限账号执行）：
   ```bash
   psql "postgres://<高权限账号>:<密码>@pgm-2ze135h6045td5ujvo.pg.rds.aliyuncs.com:5432/postgres?sslmode=verify-ca&sslrootcert=certs/ApsaraDB-CA-Chain.pem" \
     -c "CREATE DATABASE cehub OWNER ce_hub;"
   ```
2. `cp .env.production .env`，compose 中删除（或忽略）`db` 服务。
3. **应用迁移**：`docker compose run --rm app sh -c "npx drizzle-kit migrate"`。
4. ECS 上若与 RDS 同 VPC，可把 DATABASE_URL 的主机换成 RDS **内网地址**（更快且不走公网）。

- **OSS（可选替代 MinIO）**：开通 S3 兼容访问，`S3_ENDPOINT` 用**内网** endpoint（应用与 OSS 同地域时，如 `https://oss-cn-shenzhen-internal.aliyuncs.com`），`S3_FORCE_PATH_STYLE=false`；compose 中删除 `minio` 服务。当前默认方案是 compose 内置 MinIO，文件存 ECS 磁盘卷。

## 六、备份

```bash
# 数据库（建议 cron 每日执行）
docker compose exec db pg_dump -U postgres cehub | gzip > backup_$(date +%F).sql.gz

# MinIO 文件
docker run --rm -v ce-project-hub_miniodata:/data -v $(pwd):/backup alpine \
  tar czf /backup/minio_$(date +%F).tar.gz /data
```

使用 RDS/OSS 时直接用云厂商的自动备份功能。
