// 生成 1 个管理层账号(系统级 admin,自动在所有项目获得 manager 权限,可看 portfolio 组合视图)。
// 密码 Test123456,手机号 19548809999(沿用测试约定)。
// 幂等:已存在则更新角色/密码/姓名/手机号。容器内执行:node scripts/create-mgmt-user.mjs
import pg from "pg";
import bcrypt from "bcryptjs";

const MOBILE = "19548809999";
const PASSWORD = "Test123456";
const USERNAME = "mgmt";
const NAME = "管理层";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const hash = await bcrypt.hash(PASSWORD, 10);
  await client.query(
    `INSERT INTO users ("openId","username","passwordHash","name","mobile","loginMethod","role","canCreateProject")
     VALUES ($1,$1,$2,$3,$4,'password','admin',true)
     ON CONFLICT ("username") DO UPDATE
       SET "passwordHash"=EXCLUDED."passwordHash",
           "name"=EXCLUDED."name",
           "mobile"=EXCLUDED."mobile",
           "role"='admin',
           "canCreateProject"=true,
           "dingtalkUserId"=NULL,
           "dingtalkCorpUserId"=NULL`,
    [USERNAME, hash, NAME, MOBILE]
  );
  console.log(`ok: ${USERNAME} (${NAME}) role=admin`);
  console.log(`\n完成。用户名:${USERNAME},密码:${PASSWORD},手机号:${MOBILE}`);
} catch (e) {
  console.error("FAILED:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
