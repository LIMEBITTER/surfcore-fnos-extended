# 发布流程（RELEASE）

> 唯一权威。发布前重读本文件，并现读仓库状态；不要凭会话记忆。
>
> 适用：`LIMEBITTER/surfcore-fnos-extended` 的 `linux` 分支。只有正式 Release，**没有 dev 测试通道**。

## 0. 硬约束

- 唯一维护分支是 `linux`；不新建 `dev`/`main`，不改分支名。
- 版本号只写在根 `package.json`；`plugins/surfcore/package.json` 必须一致。
- 发布 = 打 tag `v{version}`；tag 必须等于根版本加 `v` 前缀。
- 发布前必须让用户确认版本号与范围；不要自行发版。
- 不 push upstream；只 push fork `origin`。

## 1. 发布前检查

```bash
cd /vol1/1000/ai-deploy/surfcore
git status --porcelain          # 必须干净
git log --oneline -5
node -e "console.log(require('./package.json').version)"
npm run test:audit              # 必须全绿
cd plugins/surfcore && npm test # 必须 0 失败
cd ../..
npm run test:version
```

版本号格式为 `X.Y.Z-linux` 或 `X.Y.Z.N-linux`（本仓库使用后者，如 `0.8.9.1-linux`）。

## 2. 写 CHANGELOG

在 `CHANGELOG.md` 顶部加：

```markdown
## [0.8.9.1-linux] - 2026-11-08

### 新增
- …
### 修复
- …
### 变更
- …
```

`test-version` 会检查 CHANGELOG 是否有当前版本小节，以及 README 顶部版本是否一致。

## 3. 提交代码

```bash
git add -A
git commit -m "release: v0.8.9.1-linux"
```

不要在这一步生成 manifest；先把代码提交，再按 HEAD 生成。

## 4. 生成安装清单（门禁）

```bash
# 工作区必须干净；脚本只读 git blob，不读工作区字节
node scripts/release-manifest.mjs
node scripts/release-manifest.mjs --verify-ref HEAD
git add release/install-manifest.json
git commit -m "chore: refresh install manifest for v0.8.9.1-linux"
```

通过标准：`--verify-ref HEAD` 输出 `问题 0 个`。

> 清单文件本身不参与哈希；它列的是 HEAD 里其他文件的 sha256。
> 先生成、再单独提交清单，tag 后的归档才能与清单逐字节一致。

## 5. 打 tag 并推送

```bash
git tag -a v0.8.9.1-linux -m "SurfCore v0.8.9.1-linux"
git push origin linux
git push origin v0.8.9.1-linux
```

确认远端：

```bash
git ls-remote --heads origin linux
git ls-remote --tags origin v0.8.9.1-linux
```

## 6. 创建 GitHub Release

使用仓库内的 token 文件（不要打印）：

```bash
TOKEN=$(cat /vol1/1000/ai-deploy/secrets/github.token)
curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/LIMEBITTER/surfcore-fnos-extended/releases \
  -d @- <<'JSON'
{
  "tag_name": "v0.8.9.1-linux",
  "name": "SurfCore v0.8.9.1-linux",
  "body": "见 CHANGELOG。",
  "draft": false,
  "prerelease": false
}
JSON
```

Release 标题只写版本号，不堆功能清单；内容放 body / CHANGELOG。

## 7. 发布后验证

```bash
# Release 能查到
curl -fsS -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/LIMEBITTER/surfcore-fnos-extended/releases/tags/v0.8.9.1-linux

# 远端 HEAD 与本地一致
git ls-remote --heads origin linux

# 安装清单与实际归档一致（下载 tag 归档后）
# curl -L -o /tmp/surfcore.tar.gz https://github.com/LIMEBITTER/surfcore-fnos-extended/archive/refs/tags/v0.8.9.1-linux.tar.gz
# tar -xzf /tmp/surfcore.tar.gz -C /tmp
# node scripts/release-manifest.mjs --verify /tmp/surfcore-fnos-extended-0.8.9.1-linux
```

通过标准：`不符 0 / 缺失 0`。

## 8. 回滚

- 未推送：`git reset --soft HEAD~1`（只撤提交，保留改动）。
- 已推送但 Release 有问题：不要 force push；发一个新 patch 版本修正，或在 GitHub 上把 Release 标为 draft / 删除 tag 后重发。
- 已安装用户：让用户重装上一个正式 Release，不要复用旧 tag 覆盖。

## 9. 记录

在 `CHANGELOG.md` 保留每个正式版本；发布完成后在会话里报告：

```
版本：v0.8.9.1-linux
提交：<sha>
tag：v0.8.9.1-linux
Release：<url>
验证：test:audit / plugin test / manifest verify / 远端 HEAD
```
