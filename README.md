<div align="center">

# 页栖 PageNest

**把散落在磁盘里的 Markdown，变成一个安静、顺手的本地工作台。**

浏览、全文搜索、块级编辑、版本回溯。没有账号，没有数据库，也不会把你的笔记搬离本机。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.12-3c873a?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/github/license/ATQQ/pagenest)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/ATQQ/pagenest?style=flat&logo=github)](https://github.com/ATQQ/pagenest)

[快速开始](#快速开始) · [核心能力](#核心能力) · [CLI](#cli) · [开发](#开发) · [技术方案](./TECHNICAL_PLAN.md)

</div>

![PageNest 工作区](./docs/pagenest-workspace.png)

PageNest 直接读取指定目录中的 Markdown 文件（`.md`、`.markdown`、`.mdown`），用浏览器提供阅读与编辑界面。正文始终以磁盘文件为唯一数据源，配置和历史保存在目标目录的 `.pagenest/` 中。

当前版本为 `0.2.0`。项目以 npm 包结构组织，包名为 `pagenest`，安装后同时提供短命令 `pn` 和完整命令 `pagenest`。

## 为什么是 PageNest

- **Local-first**：笔记留在原来的目录里，可直接用 Git、iCloud、Dropbox 或任意编辑器继续管理。
- **读写一体**：先专注阅读，需要时再进入块级或整篇源码编辑，不必在多个工具之间切换。
- **对现有目录友好**：自动读取根目录 `.gitignore`，不要求导入、迁移或改写已有文件结构。
- **可回溯**：保存前自动留快照，支持历史 diff、恢复和磁盘并发修改冲突处理。
- **轻量运行**：单个 Node 进程托管前端与 API，生产环境零运行时依赖。

## 核心能力

| 能力         | 说明                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| 文档导航     | 树形目录与平铺列表两种模式，筛选只匹配标题和路径                               |
| 全文搜索     | 独立 `⌘/Ctrl+K` 弹窗，匹配标题、路径和正文，展示上下文摘要、行号与文件位置     |
| 多文档工作区 | 文档标签、章节收藏、草稿恢复、滚动位置和侧栏状态持久化                         |
| 块级编辑     | 标题、段落、引用原地富文本编辑；列表、表格、代码等复杂块使用 Markdown 片段编辑 |
| 源码编辑     | CodeMirror 6 整篇 Markdown 编辑，支持高亮、搜索、撤销重做和 `⌘/Ctrl+S`         |
| 历史与冲突   | 保存前快照、历史 diff、恢复前自动存档、SHA-256 并发修改检测                    |
| 忽略规则     | 合并根目录 `.gitignore`、页面规则和 CLI `--ignore`，跳过符号链接               |
| 响应式界面   | 纸质/夜读双主题，桌面三栏、平板抽屉与移动端布局                                |

## 快速开始

### 环境要求

- Node.js `>= 22.12`
- npm
- 支持现代 JavaScript 的浏览器

### 从 GitHub 获取

```bash
git clone https://github.com/ATQQ/pagenest.git
cd pagenest
npm install
npm run build
node ./bin/pagenest.js /path/to/notes
```

不传目录时使用当前运行目录：

```bash
cd /path/to/notes
node /path/to/pagenest/bin/pagenest.js
```

建立本地全局命令：

```bash
cd pagenest
npm link
pn /path/to/notes
```

默认打开 `http://127.0.0.1:4321/`。按 `Ctrl+C` 停止服务。

## CLI

```text
pn [directory] [options]
pagenest [directory] [options]
```

| 参数                  | 说明                                      |
| --------------------- | ----------------------------------------- |
| `-p, --port <number>` | 监听端口，默认 `4321`；`0` 表示由系统分配 |
| `--host <host>`       | 监听地址，默认 `127.0.0.1`                |
| `--token [token]`     | 启用访问令牌；非本机监听时自动生成        |
| `-i, --ignore <rule>` | 追加一条 Git-style 忽略规则，可重复       |
| `--open`              | 启动后打开浏览器，默认开启                |
| `--no-open`           | 不自动打开浏览器                          |
| `-h, --help`          | 显示帮助                                  |
| `-v, --version`       | 显示版本                                  |

示例：

```bash
pn ./docs --port 8080 --no-open
pn ./notes --host 0.0.0.0
pn ./notes --ignore drafts/ --ignore "**/archive/"
pagenest ./notes --token my-private-token
```

## 使用方式

### 导航、搜索与速记

- 左侧 `树形` 保留目录层级和展开状态；`列表` 平铺显示全部 Markdown。
- 左侧筛选框只过滤文章标题和路径，不读取正文。
- 顶部全文档搜索是独立弹窗。它匹配标题、路径和正文，并显示上下文摘要、行号与文件位置。
- 标题左侧星标可收藏章节。顶部“速记”按文档聚合收藏，点击后回到对应章节。
- 收藏优先按稳定标题 ID 定位；标题改名或移动后依次按文本、块位置回退，失效时可手动移除。

### 编辑与保存

- 点击“编辑”，再点击正文块进入原地编辑。
- 标题、段落、引用支持富文本编辑；列表、表格、代码块等复杂结构自动改用 Markdown 片段编辑。
- “源码”切换到整篇 Markdown，支持语法高亮、搜索、撤销重做与 `⌘/Ctrl+S`。
- 富文本、块源码和整篇源码共享同一份草稿，不会产生多套内容状态。
- 草稿写入 `localStorage`，刷新或重新打开页面后可恢复。
- 手动保存会先为磁盘上的旧正文创建“保存前快照”，再原子写回新内容。
- 关闭有未保存修改的标签时会要求保存、放弃或继续编辑。

### 文件、历史与冲突

Markdown 文件始终是正文的唯一数据源，PageNest 不建立数据库。

```text
your-notes/
├── README.md
├── guides/
│   └── start.md
└── .pagenest/
    ├── settings.json
    └── history/
        └── d-<document-id>/
            ├── index.json
            └── v-<version-id>.md
```

- 保存前快照正文和 `index.json` 采用原子写入。
- 每篇文档最多保留 200 个历史版本。
- 历史恢复前会先创建“恢复前自动存档”，恢复本身仍可撤回。
- 保存请求携带打开文件时的 SHA-256 哈希；磁盘被其他程序修改时返回 `409 DOCUMENT_CHANGED`。
- 冲突弹层支持查看差异、加载磁盘版本或以“冲突：保留本地”强制保存本地草稿。
- SSE 会把其他页面的保存、创建与设置变化通知当前页面；当前文档有草稿时只提示，不静默覆盖。

浏览器 UI 状态保存在 `pagenest.ui.v2`，包括标签、草稿、收藏、主题、侧栏、树展开状态和导航偏好。首次升级会导入 `pagenest.ui.v1` 中可恢复的数据。

## 扫描与忽略

扫描规则按以下顺序合并：

1. 始终跳过 `.git/`、`.pagenest/` 和符号链接。
2. 自动读取根目录 `.gitignore`。
3. 叠加页面“忽略规则”中保存到 `.pagenest/settings.json` 的规则。
4. 叠加本次 CLI `--ignore` 规则。

支持常用 Git-style 语法：

```gitignore
node_modules/
private/
*.draft.md
/root-only/
docs/*
!docs/keep.md
**/archive/
```

PageNest 不试图完整复刻 Git 的全部 ignore 语义，因此保留了页面和 CLI 两层补充规则。当前只读取根目录 `.gitignore`，不读取嵌套 `.gitignore` 或全局 Git excludes。

## 开发

```bash
git clone https://github.com/ATQQ/pagenest.git
cd pagenest
npm install
npm run dev -- /path/to/notes
```

开发模式由 Vite 在 `5173` 提供 HMR，Node 服务在 `4321` 提供 `/api` 与 SSE，并自动代理。

常用质量命令：

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run pack:check
```

运行完整验收：

```bash
npm run verify
```

主要目录：

```text
src/client/      React 工作区、Markdown 渲染、编辑器和浏览器状态
src/server/      扫描、忽略规则、文件写入、历史、HTTP 与 SSE
src/cli/         参数解析、监听地址、token 与浏览器启动
src/shared/      前后端 TypeScript 契约
test/            单元、集成与 Playwright 验收
docs/            README 截图等项目资源
dist/            Vite 客户端与 tsc 服务端构建产物
```

详细架构、兼容边界与演进路线见 [TECHNICAL_PLAN.md](./TECHNICAL_PLAN.md)。

如果遇到问题或有功能建议，请提交 [Issue](https://github.com/ATQQ/pagenest/issues)；代码贡献请从 [Pull Request](https://github.com/ATQQ/pagenest/pulls) 开始。

## 局域网访问

监听 `0.0.0.0`、`::` 或其他非 loopback 地址时会自动生成访问令牌。首次打开带 token 的地址后，服务写入 `HttpOnly`、`SameSite=Strict` Cookie，后续请求不再需要在 URL 中重复携带 token。

```bash
pn ./notes --host 0.0.0.0
```

只应在可信局域网中使用。访问令牌不能替代 HTTPS、系统防火墙或网络访问控制。

## 安全边界

- 默认只监听 `127.0.0.1`。
- 文档路径经过规范化和根目录边界检查，拒绝路径穿越。
- 写请求校验同源 `Origin`。
- 响应设置 CSP、`X-Content-Type-Options`、`Referrer-Policy` 和 `X-Frame-Options`。
- Markdown 按可信本地内容处理；PageNest 不是面向不可信公网用户的多人 CMS。

## 已知限制

- 没有账号、云同步、多人实时协作和公网托管。
- 没有文件监听器；外部修改通过重新扫描、保存哈希校验和 SSE 提示处理。
- 历史依赖本地 `.pagenest/`，不会自动同步或备份。
- 富文本编辑覆盖常见 GFM；复杂 Markdown 建议使用片段或整篇源码模式。
- 暂不支持公式、Mermaid、内嵌 HTML 和插件。
- 相对图片、附件和跨 Markdown 文档链接属于 `0.3` 内容完整性阶段。

## License

[MIT](./LICENSE) © PageNest contributors
