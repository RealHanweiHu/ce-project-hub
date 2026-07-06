// 生成 6 个测试账号(对应不同项目角色),手机号统一 19548809999,密码统一 Test123456。
// 幂等:已存在则更新手机号/密码/姓名。容器内执行:node scripts/create-test-users.mjs
import pg from "pg";
import bcrypt from "bcryptjs";

const MOBILE = "19548809999";
const PASSWORD = "Test123456";
// username, 姓名, 建议担任的项目角色(实际角色由立项向导/成员管理分配)
const USERS = [
  ["test_pm",   "测试·产品经理", "pm"],
  ["test_ee",   "测试·硬件EE",   "rd_hw"],
  ["test_mech", "测试·结构ID",   "rd_mech"],
  ["test_sw",   "测试·软件SW",   "rd_sw"],
  ["test_qa",   "测试·测试品质", "qa"],
  ["test_scm",  "测试·供应链",   "scm"],
];

// ⚠ 仅供测试/演示：固定弱密码 Test123456，且会重置同名已有账号的密码。
// 防止误跑生产：NODE_ENV=production 时必须显式 --force 才执行。
if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
  console.error("拒绝执行：生产环境创建固定弱密码测试账号。确需请加 --force。");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const hash = await bcrypt.hash(PASSWORD, 10);
  for (const [username, name] of USERS) {
    await client.query(
      `INSERT INTO users ("openId","username","passwordHash","name","mobile","loginMethod","role","canCreateProject")
       VALUES ($1,$1,$2,$3,$4,'password','member',false)
       ON CONFLICT ("username") DO UPDATE
         SET "passwordHash"=EXCLUDED."passwordHash",
             "name"=EXCLUDED."name",
             "mobile"=EXCLUDED."mobile",
             "dingtalkUserId"=NULL,
             "dingtalkCorpUserId"=NULL`,
      [username, hash, name, MOBILE]
    );
    console.log(`ok: ${username} (${name})`);
  }
  console.log(`\n全部完成。账号密码统一:${PASSWORD},手机号:${MOBILE}`);
} catch (e) {
  console.error("FAILED:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
