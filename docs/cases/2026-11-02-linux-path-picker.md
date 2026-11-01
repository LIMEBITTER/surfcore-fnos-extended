# 2026-11-02 Linux「浏览…」不可用（B站 工具链等路径选择）

## 现象

- 飞牛 OS 上打开 SurfCore → B站 → 工具链 → `bili.mjs 路径` 点「浏览…」；
- 返回：`只有 Windows 支持原生选择框，请手动填路径`；
- 语音库目录、ffmpeg 路径、会话工作目录、SnowLuma 路径等所有带「浏览…」的字段同样受影响。

## 根因

`plugins/surfcore/lib/index.js` 的 `handleBrowse` 用 PowerShell + `System.Windows.Forms` 弹原生框，
非 Windows 直接返回错误；前端 `browseNative()` 只调这个接口，没有 Linux/远程 Web 的替代路径。
在浏览器里无法拿到本机绝对路径，所以不能靠 `<input type=file>` 解决。

## 修法

- 新增只读目录浏览接口 `GET /dsh-surfcore/api/browse/list?mode=dir|file&path=...`
  - 返回 `{ ok, path, parent, home, entries:[{name,type,path}] }`；
  - 支持 `~` 展开、文件模式、目录优先排序、不可读时返回可读错误；
- 前端新增 `PathPickerModal`：
  - 地址栏 + 转到、上一级、主目录；
  - 目录列表（文件模式下列出文件），点目录进入、点文件选中；
  - 「选择当前目录 / 选择文件」把绝对路径交回字段；
- `browseNative()` 优先走页面内选择器；没有挂载时仍回退旧的宿主接口。

## 验证

- `GET /api/browse/list?mode=dir&path=~` → `ok:true`、`/home/baiyu`、条目正常；
- `mode=file&path=/usr/bin` → `ok:true`、目录+文件混合、最多 1000 条；
- `npm run test:audit` 109/109；
- 未验证：真实浏览器点击（NAS 无头，需在 DSH 页面手动点一次）。

## 影响面

- 仅改变「浏览…」的交互路径；Windows 原生 PowerShell 代码保留，但本 fork 默认走 Web 选择器。
- 不涉及配置格式、额度、发布链路。
