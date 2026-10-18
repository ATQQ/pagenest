# 页栖 PageNest 技术方案

## 1. 目标与边界

PageNest 的目标是把任意本地 Markdown 目录转换成一个可直接分享使用的浏览器工作台：

```bash
pn ~/notes
```

首版聚焦单机、本地优先和个人使用，不引入账号、数据库、云同步或多人实时协作。

核心约束：

- Markdown 文件是正文的唯一数据源。
- 零运行时依赖，降低安装、审计和分享成本。
- 默认不暴露到局域网；显式监听非 loopback 地址时必须启用 token。
- UI 可以保存在浏览器，正文和历史必须可落盘、可追溯。
- 不实现重命名、移动和删除，缩小首版文件系统操作面。

## 2. 架构

```text
┌──────────────── Browser ────────────────┐
│ public/index.html                       │
│ public/style.css                        │
│ public/app.js                           │
│   ├─ UI state / drafts / favorites      │
│   ├─ Markdown parser + block editor     │
│   ├─ tabs / search / outline / history  │
│   └─ fetch + EventSource                │
└──────────────────┬──────────────────────┘
                   │ HTTP / JSON / SSE
┌──────────────────▼──────────────────────┐
│ Node.js server                          │
│ src/server.js                           │
│   ├─ static files                       │
│   ├─ API router                         │
│   ├─ origin / token / security headers  │
│   └─ SSE update hub                     │
│ src/library.js                          │
│   ├─ scan / path safety                 │
│   ├─ atomic write / hash check          │
│   ├─ create / search                    │
│   └─ snapshots / restore                │
│ src/cli.js                              │
│   └─ args / host / token / browser      │
└──────────────────┬──────────────────────┘
                   │ fs
┌──────────────────▼──────────────────────┐
│ Markdown root/                          │
│   *.md                                  │
│   .pagenest/history/<docId>/             │
└─────────────────────────────────────────┘
```

## 3. 模块边界

| 模块 | 职责 | 不负责 |
| --- | --- | --- |
| `bin/pagenest.js` | 进程入口、错误退出码 | 业务逻辑 |
| `src/cli.js` | 参数解析、监听地址、token、打开浏览器 | 文件读写 |
| `src/server.js` | HTTP、静态资源、API、SSE、安全响应头 | Markdown 语义 |
| `src/library.js` | 目录扫描、路径安全、保存、历史、恢复、搜索 | 浏览器交互 |
| `public/app.js` | 前端状态、Markdown 渲染、编辑、搜索、diff | 直接访问文件系统 |
| `public/style.css` | 响应式布局和双主题 | 数据持久化 |

这样划分的关键目的，是让所有写入、快照和恢复行为集中在 `Library`，避免前端、HTTP 层和历史逻辑各自演化出不同的保存语义。

## 4. 文档与版本模型

服务端返回的文档：

```js
{
  id: "d-<sha256(path).slice(0, 20)>",
  path: "guides/start.md",
  title: "开始使用",
  markdown: "# 开始使用\n...",
  updatedAt: 1760000000000,
  size: 1234,
  hash: "<sha256(markdown)>"
}
```

历史摘要：

```js
{
  id: "v-<time>-<random>",
  docId: "d-...",
  createdAt: 1760000000000,
  reason: "保存前快照",
  charDelta: 12,
  hash: "<sha256(markdown)>",
  size: 1246
}
```

前端 UI 状态：

```js
{
  version: 1,
  tabs: [{ docId, dirty, scrollTop }],
  activeDocId,
  drafts: { [docId]: markdown },
  favorites: { [docId]: [{ id, title, level, blockIndex }] },
  ui: {
    theme: "paper",
    sidebarCollapsed: false,
    folders: [],
    railTab: "outline",
    navMode: "tree"
  }
}
```

`localStorage["pagenest.ui.v1"]` 只用于阅读体验恢复。清除浏览器存储不会丢失正文或历史。

## 5. HTTP API

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查与根目录名 |
| `GET` | `/api/bootstrap` | 文档、版本摘要、根目录信息 |
| `GET` | `/api/docs/:id` | 单篇文档与历史摘要 |
| `POST` | `/api/docs` | 新建 Markdown |
| `PUT` | `/api/docs/:id` | 保存正文 |
| `GET` | `/api/docs/:id/versions` | 历史摘要列表 |
| `GET` | `/api/docs/:id/versions/:versionId` | 单个历史版本正文 |
| `POST` | `/api/docs/:id/versions/:versionId/restore` | 恢复历史版本 |
| `GET` | `/api/search?q=` | 服务端全文检索 |
| `GET` | `/api/events` | SSE 文档变更事件 |

保存请求：

```json
{
  "markdown": "# Updated\n",
  "baseHash": "<hash returned when opened>",
  "force": false
}
```

错误使用稳定结构：

```json
{
  "error": {
    "code": "DOCUMENT_CHANGED",
    "message": "The file changed on disk after you opened it.",
    "details": {
      "current": { "...": "latest disk document" },
      "versions": []
    }
  }
}
```

## 6. 保存流程

```text
browser PUT(markdown, baseHash)
        │
        ▼
scan current file ── hash differs? ── yes ──► 409 + current disk doc
        │ no
        ▼
content unchanged? ── yes ──► saved: false
        │ no
        ▼
snapshot current disk markdown to .pagenest/history
        │
        ▼
atomic write new markdown
        │
        ▼
scan again, return new doc + versions
        │
        ▼
SSE document-updated
```

冲突时的三个产品路径：

1. `保留本地`：强制覆盖磁盘，并在历史中记录“冲突：保留本地”。
2. `加载对方`：丢弃当前草稿，重新读取磁盘版本。
3. `查看差异`：对比磁盘版本与本地未保存正文。

前端仍然先保存本地草稿，因此冲突弹层关闭、网络抖动或页面刷新不会直接丢失未保存内容。

## 7. 历史与恢复

- 保存前快照当前磁盘版本，而不是新正文。
- 恢复版本前，先为当前正文创建“恢复前自动存档”。
- 快照采用“索引 + 独立 Markdown 文件”，索引原子更新。
- 每篇最多保留 200 个版本；超过后删除最旧的快照文件。
- 相同正文且相同原因不会重复创建快照。
- diff 在前端按行计算，桌面端并排展示，移动端展示统一 diff。

该模型保证“当前正文 + 历史”始终能回到最近一次操作前，不依赖浏览器是否关闭。

## 8. 前端设计

前端保持无构建步骤：

- `index.html` 提供语义结构、弹层和抽屉。
- `style.css` 使用 CSS 变量控制纸质/夜读主题和响应式布局。
- `app.js` 使用原生 DOM、Fetch 和 EventSource。

Markdown 被拆成可编辑块：标题、段落、列表、任务、引用、代码、表格和分隔线。每个块保留自己的 Markdown 源片段；编辑完成后由 DOM 转回 Markdown，再通过统一的 `setWorkingMarkdown` 入口更新草稿、标签脏状态和保存提示。

状态更新原则：

- 富文本编辑、源码编辑和草稿恢复都写入 `state.drafts`。
- `dirty` 通过“工作区 Markdown 是否等于服务端 Markdown”推导。
- 保存成功后统一替换服务端文档、版本列表和草稿状态。
- 恢复成功后走与保存相同的替换入口，避免历史和阅读视图不一致。

## 9. 搜索与导航

- 左侧过滤只匹配文章标题和路径，保持导航用途。
- 顶部搜索使用独立弹窗，匹配标题、路径和正文，并提供命中摘要。
- 搜索结果复用已打开标签，否则创建新标签；打开后滚动到命中的块并高亮。
- 目录树展开状态单独持久化；平铺列表不依赖目录展开状态。
- 收藏保存章节标题和块位置；定位失败时提示章节已改名或被移除。

## 10. 安全模型

- 默认绑定 `127.0.0.1`。
- 非 loopback 地址自动生成随机 token。
- token 支持 URL 查询参数、`X-PageNest-Token` Header 和 HttpOnly Cookie；查询参数首次使用后重定向到不含 token 的 URL。
- Cookie 使用 `SameSite=Strict`；跨站写请求还会被 Origin 校验拒绝。
- 静态资源路径限制在 `public/`；文档路径限制在用户指定根目录。
- 文档扫描跳过符号链接、隐藏目录、`.git`、`.pagenest` 和 `node_modules`。
- 正文写入使用原子替换，并保留原文件权限。
- CSP 禁止外部脚本、外部样式和 frame 嵌入。

首版面向可信本地目录。若未来面向公网，需要增加 HTTPS 引导、正式身份认证、速率限制、审计日志和更严格的 CSRF/Origin 策略。

## 11. 性能与规模

- 单目录最多扫描 20,000 篇 Markdown。
- 每次 bootstrap 读取所有文档正文和每篇历史索引，适合个人知识库，不适合超大 monorepo。
- 正文按需打开；标签只保存 `docId`、脏状态和滚动位置。
- 每篇历史顶部截断到 200 条，避免索引无限增长。

后续若需要万篇以上规模，可增加启动索引缓存、按需读取正文、目录增量扫描和分页历史 API。

## 12. 测试策略

当前自动化覆盖：

- 目录扫描、忽略规则、标题推导和 ID 生成
- 路径穿越和扩展名拒绝
- 外部修改冲突
- 原子保存、保存前快照和恢复
- 新建嵌套文档
- bootstrap、单篇读取、版本读取/恢复 API
- token Header、query 重定向和 Cookie
- 空目录 bootstrap
- CLI 参数解析

浏览器验收覆盖：

- `file://` 原型阶段已退出；正式版必须通过 HTTP 启动。
- 桌面三栏、平板底部抽屉、移动端目录抽屉
- 树形/列表切换、主题、搜索、收藏、草稿恢复
- 块编辑、源码切换、快捷键保存
- 历史 diff、恢复、真实磁盘冲突三条路径
- 320/390/768/1024/1440 宽度与基本无障碍检查

## 13. 已知限制与后续路线

首版限制：

- 无文件系统 watcher，外部修改主要靠保存哈希和 SSE 获知。
- 无多人协同、账号、权限、云同步。
- 不处理相对图片、附件和跨文档链接解析。
- 富文本编辑适合常见 GFM；复杂结构建议源码模式。
- npm 包名 `pagenest`，同时注册 `pn` 与 `pagenest` 两个 bin。

建议路线：

1. 增加根目录静态资源代理，支持相对图片和附件。
2. 增加文件监听与增量索引。
3. 增加文档内链接跳转、最近打开和全文搜索排序。
4. 增加可选配置文件和端口自动避让。
5. 评估多人协作时再引入身份、锁或 CRDT，不把协作复杂度提前塞进首版。
