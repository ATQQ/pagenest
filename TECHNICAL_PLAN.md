# 页栖 PageNest 技术方案

## 1. 阶段目标

0.1.0 是首个公开版本，核心任务是把可点击原型一次性升级为可发布、可测试、可持续演进的 TypeScript 工程，同时保持现有产品体验和磁盘兼容：

- 保持 `pn [directory]`、`pagenest [directory]`、缺省当前目录和既有忽略规则行为。
- 保持 Markdown 为正文唯一数据源，不引入账号、数据库、云同步或多人协作。
- 保持 `.pagenest/settings.json`、历史索引、历史文件与文件权限不被迁移破坏。
- 完成 vanilla JS 到 React/Vite、JS 到 strict TypeScript 的单次切换。
- 建立 lint、类型、单元、浏览器、构建和 npm 打包验收链路。

技术方案不包含公网托管。

## 2. 技术栈

### 2.1 运行时

| 项目       | 选择                                  |
| ---------- | ------------------------------------- |
| Node.js    | `>=22.12.0`；CI 覆盖 22.12 与 24.x    |
| 包管理     | pnpm 10 + `pnpm-lock.yaml`            |
| 服务端     | Node 原生 `http`、`fs`、`crypto`、SSE |
| 运行时依赖 | 0；前端依赖在构建时全部打包           |
| 模块格式   | ESM                                   |

服务端不引入 Express/Fastify，保持发布包轻量和 HTTP 行为可控。

### 2.2 前端与工程

| 类别       | 依赖                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| 框架       | React `19.3.1`、React DOM `19.3.1`                                                     |
| 构建       | Vite `8.3.4`、`@vitejs/plugin-react 6.1.2`                                             |
| 语言       | TypeScript `6.0.3`                                                                     |
| 状态       | Zustand `5.0.15`                                                                       |
| 基础组件   | Radix Dialog、AlertDialog、Tabs、DropdownMenu、Tooltip、ScrollArea                     |
| 样式       | CSS Variables + CSS Modules，八套阅读主题（纸页/羊皮纸/纯白/护眼/豆沙/夜读/墨夜/纯黑） |
| Markdown   | unified、remark-parse、remark-gfm、remark-rehype、rehype-react、rehype-sanitize        |
| 代码高亮   | Shiki core + JavaScript 正则引擎，只打包常用语言与高对比度明暗主题                     |
| 源码编辑器 | CodeMirror 6，动态导入                                                                 |
| Diff       | `diff 9.0.0`                                                                           |

TypeScript 固定在 6.0.x，因为当前 `typescript-eslint 8.71.2` 尚不支持 TypeScript 7。升级 TS 前先确认 ESLint parser 的 peer range。

不使用 Redux、TanStack Query、React Router、Tailwind 或 shadcn 默认主题。项目只有单工作区页面，路由和表单库不会带来足够收益。

### 2.3 测试与质量

- Vitest `5.0.5`、Testing Library React、jsdom
- Playwright `1.64.1` + Chromium
- `@axe-core/playwright`
- ESLint `10.13.0`、Prettier `3.9.10`

## 3. 工程结构

```text
pagenest/
├── bin/pagenest.js           # 可执行入口，只调用 dist/cli
├── src/
│   ├── cli/index.ts          # 参数、host/port、token、浏览器
│   ├── cli/main.ts           # 开发入口，从源码直接运行 CLI
│   ├── server/
│   │   ├── ignore.ts         # Git-style 匹配器
│   │   ├── library.ts        # 扫描、保存、历史、搜索
│   │   └── server.ts         # HTTP、静态资源、API、SSE、安全头
│   ├── shared/contracts.ts   # 前后端模型与事件类型
│   └── client/
│       ├── App.tsx
│       ├── components/
│       ├── markdown/
│       ├── store/workspace.ts
│       └── styles/
├── test/
│   ├── client/
│   ├── e2e/
│   └── fixtures/
├── scripts/
│   ├── dev.mjs
│   └── e2e-server.mjs
├── dist/client/              # Vite 产物
├── dist/server/              # tsc 服务端产物
└── dist/cli/                 # tsc CLI 产物
```

单 npm 包，不使用 monorepo。`package.json#exports` 指向 `dist/server/server.js`；发布包只包含 `bin`、`dist`、文档和 License。

## 4. 运行架构

```text
Browser
  React + Zustand + Radix
  unified Markdown blocks / CodeMirror
  fetch + EventSource
        │ HTTP JSON + SSE
        ▼
Node native server
  static dist/client
  API router / origin / token / security headers
  SSE hub
        │
        ▼
Library
  scan / ignore / path safety
  atomic write / hash conflict check
  create / search
  history snapshot / restore
        │
        ▼
Markdown root
  *.md / *.markdown / *.mdown
  .pagenest/settings.json
  .pagenest/history/<docId>/
```

生产模式由同一个 Node 进程托管静态资源和 API。开发模式由 Vite HMR 服务客户端，Node 服务只处理 API，Vite 把 `/api` 与 `/api/events` 代理到 `4321`。

## 5. 前端状态模型

Zustand 状态分为两层：

### 5.1 服务端数据

不持久化：

```ts
{
  docs: Record<string, DocumentModel>;
  docOrder: string[];
  versions: Record<string, VersionSummary[]>;
  rootName: string;
  versionLimit: number;
  settings: Settings;
  ready: boolean;
  loading: boolean;
  error: string;
}
```

### 5.2 工作区状态

持久化到 `localStorage["pagenest.ui.v2"]`：

```ts
{
  tabs: [{ docId, scrollTop }];
  activeDocId: string | null;
  drafts: Record<string, string>;
  favorites: Record<string, Favorite[]>;
  ui: {
    theme: ThemeId; // paper | sepia | white | eye | douchi | night | dark | amoled
    sidebarCollapsed: boolean;
    folders: string[];
    railTab: "outline" | "history";
    navMode: "tree" | "list";
  };
}
```

标签脏状态不再保存为独立可变字段，而是由 `draft !== disk markdown` 推导。富文本、块源码、整篇源码和草稿恢复都必须经过 `setDraft`。

没有合法活动标签时，优先打开根目录 `README.md`（大小写不敏感），否则选择扫描结果第一篇。

### 5.3 v1 迁移

1. 优先读取 `pagenest.ui.v2`。
2. v2 不存在时读取 `pagenest.ui.v1`。
3. 丢弃旧 `dirty` 字段，保留标签、滚动位置、草稿、收藏和 UI。
4. 为旧收藏补齐 `line` 字段并为其他字段归一化。
5. 成功写入 v2 后才停止读取 v1。

迁移不会删除 v1，避免首次升级写入失败时丢失未保存内容。

## 6. Markdown 阅读与编辑

unified 管线把正文解析为带 source offset 的顶层块：

```ts
{
  id;
  index;
  kind;
  markdown;
  start;
  end;
  startLine;
  endLine;
  headingId?;
  headingText?;
  level?;
}
```

- 块编辑只替换对应 source range，未编辑内容不做格式化。
- 标题、段落和引用使用 `contenteditable` 原地编辑，DOM 再转回 Markdown。
- 列表、任务、表格、代码等无法稳定富文本化的块进入 Markdown 片段编辑。
- 富文本失焦、`Esc` 或 `⌘/Ctrl+Enter` 都通过同一 commit 路径更新草稿。
- 代码围栏由 Shiki 同步高亮，输出明暗双主题 token；不额外加载 WASM。
- 整篇源码模式只在开启时动态加载 CodeMirror，支持 Markdown 高亮、search、history 与 `⌘/Ctrl+S`。
- `⌘/Ctrl+S` 会先提交当前活动块，再保存，避免编辑 DOM 与 Zustand 草稿短暂不一致。

Markdown 渲染经过 `rehype-sanitize`。当前 GFM 范围不包括公式、Mermaid、内嵌 HTML 和插件。

## 7. HTTP API 与事件

| Method | Path                                        | 说明                             |
| ------ | ------------------------------------------- | -------------------------------- |
| `GET`  | `/api/health`                               | 健康检查与根目录名               |
| `GET`  | `/api/bootstrap`                            | 文档、版本摘要、设置、根目录信息 |
| `GET`  | `/api/settings`                             | 忽略规则与 `.gitignore` 状态     |
| `PUT`  | `/api/settings`                             | 保存页面规则并重新扫描           |
| `GET`  | `/api/docs`                                 | 文档列表                         |
| `POST` | `/api/docs`                                 | 新建 Markdown                    |
| `GET`  | `/api/docs/:id`                             | 单篇文档与历史摘要               |
| `PUT`  | `/api/docs/:id`                             | 保存正文                         |
| `GET`  | `/api/docs/:id/versions`                    | 历史摘要                         |
| `GET`  | `/api/docs/:id/versions/:versionId`         | 历史正文                         |
| `POST` | `/api/docs/:id/versions/:versionId/restore` | 恢复历史                         |
| `GET`  | `/api/search?q=`                            | 服务端全文搜索                   |
| `GET`  | `/api/events`                               | SSE                              |

`/api/search` 相比原型增加 `snippet` 和 `line`，旧字段保持兼容。错误统一为：

```json
{
  "error": {
    "code": "DOCUMENT_CHANGED",
    "message": "The file changed on disk after you opened it.",
    "details": {}
  }
}
```

搜索按标题、路径和正文加权排序，支持空格分隔的多关键词、拉丁词拼写容错、中文
字符顺序命中以及前缀/子串匹配。精确命中优先，其次补充模糊结果；单次最多返回
100 篇文档，避免宽泛查询淹没工作区。`bootstrap` 会构建包含小写字段和去重词表的
内存搜索快照，保存、创建、恢复、忽略规则变更与重新扫描时失效，避免每次输入都
重新读取整个资料夹。

SSE 使用类型化事件：

- `document-updated`
- `document-created`
- `settings-updated`

当前文档存在草稿时，外部 `document-updated` 只显示提示，不覆盖草稿；没有草稿时刷新文档与版本。创建和设置事件触发 bootstrap 同步。

## 8. 保存、历史与冲突

保存流程：

```text
PUT(markdown, baseHash)
  → 扫描当前磁盘正文
  → 哈希不同：409 + 最新文档
  → 内容未变：saved=false
  → 保存磁盘旧正文为“保存前快照”
  → 临时文件 + rename 原子写入
  → 返回新文档与版本列表
  → SSE document-updated
```

冲突有三条路径：

1. `加载对方`：丢弃当前草稿，载入磁盘版本。
2. `查看差异`：左侧磁盘、右侧本地，移动端使用统一 diff。
3. `保留本地`：带 `force` 强制保存，历史原因记录为“冲突：保留本地”。

恢复历史版本前先创建“恢复前自动存档”。每篇最多 200 个版本，索引与正文分别原子写入；丢弃旧版本时只删除不再被索引引用的文件。

## 9. 导航、搜索与收藏

- 左侧树形模式保留祖先分支和展开状态，列表模式平铺全部文档。
- 左侧筛选只匹配标题和路径，不调用正文搜索。
- 顶部搜索使用独立 Radix Dialog 和独立查询状态；服务端搜索，前端以 `AbortController` 取消旧请求。
- 搜索结果打开或复用现有文档标签，并定位首次命中的块。
- 收藏模型保存 `{ id, title, level, blockIndex, line }`，定位降级顺序为标题 ID、标题文本、块位置。

## 10. 响应式与可访问性

断点：

- `<768px`：目录抽屉、底部页面/历史抽屉、移动端源码快捷入口。
- `768–1023px`：隐藏常驻右栏，改为底部抽屉。
- `>=1024px`：左侧目录、正文、右侧本页目录/历史三栏。

弹窗使用 Radix 管理焦点、Esc、焦点回收和 modal 语义。交互目标保留移动端点击面积；隐藏文字使用可访问名称或视觉隐藏而不是简单移除语义。Playwright axe 检查目录、搜索、历史、冲突、忽略规则和响应式主界面。

## 11. 质量与发布

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm pack:check
```

构建顺序：

1. 清理 `dist`。
2. Vite 输出 `dist/client`。
3. `tsc -p tsconfig.server.json` 输出 `dist/server` 与 `dist/cli`。
4. `pnpm pack` 打包后用 tarball 在临时目录安装，真实运行 `pn --no-open` 验证扫描、打开、保存和 SSE。

CI 使用 Node 22.12 与 24.x 矩阵，执行相同质量链路。仓库保持独立 Git 历史，由维护者自行配置 remote 和推送。

## 12. 安全模型

- 默认只绑定 `127.0.0.1`。
- 非 loopback 监听自动生成 token；支持 query、Header 和 HttpOnly/SameSite=Strict Cookie。
- query token 首次访问后重定向到不含 token 的 URL。
- 写请求拒绝跨站 Origin。
- 静态资源限制在 `dist/client`，文档路径限制在用户根目录。
- 扫描始终跳过符号链接、`.git` 和 `.pagenest`。
- CSP 禁止外部脚本和外部样式；Markdown 经过 sanitize。
- 正文写入保留原文件权限并使用原子 rename。

页面访问令牌解决的是局域网误访问，不等同于正式身份系统。公网部署需要 HTTPS、身份、权限、速率限制与审计。

## 13. 兼容边界

- CLI 命令、参数、默认目录和 token 行为与原型保持兼容。
- HTTP 路径、文档模型、版本模型和错误结构保持兼容；搜索只做字段增量。
- `.pagenest/settings.json`、history 目录和 Markdown 文件格式不变。
- 旧 `public/` 前端已删除，不长期维护双前端。
- 浏览器存储从 v1 一次性迁移到 v2。
- 升级不重写用户 Markdown、历史文件或权限。

## 14. 演进路线

### 0.2 内容完整性

- 根目录范围内的只读附件和图片服务。
- 相对图片、附件、Markdown 文档互链与锚点跳转。
- 使用 chokidar 增加文件监听与增量扫描。
- 补齐嵌套 `.gitignore` 语义。

### 0.3 规模与分享

- bootstrap 拆分元数据与正文按需读取。
- 持久索引、分页搜索和搜索排序。
- 触发条件：超过约 5,000 篇文档或首屏正文读取超过 1.5 秒。
- 只读静态导出/分享命令。
- 评估 Node SEA 独立二进制。

### 0.4 扩展性

- 在内容、资源和发布链路稳定后开放 math、Mermaid 等插件。
- 新 API 优先以新增端点演进；破坏响应结构时使用 `/api/v2` 并保留至少一个 minor 版本的兼容入口。

账号、云同步、CRDT、多人实时协作和公网托管不属于 0.1–0.3 范围。未来若引入，身份、权限与审计必须作为独立架构阶段处理。

## 15. 当前假设

- 以 `pagenest` 包名发布到 npm（截至 2026-10-18 未被占用），首个版本为 0.1.0。
- 单工作区、单用户、本地可信目录是默认使用模型。
- 大文件和多文档的高频全文搜索仍未建立磁盘索引；当前实现适合个人知识库。
- CodeMirror 主包已动态拆分，但 React/unified 主 chunk 仍约 564 KB；在功能稳定前不为了体积牺牲编辑可靠性。
