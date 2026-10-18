# 页栖 PageNest

PageNest 是一个本地优先的 Markdown 工作台。运行一条命令，就能在浏览器中阅读、搜索、块级编辑并回溯指定目录下的 Markdown 文件。

当前版本为 `0.1.0`，npm 包名为 `pagenest`。安装后同时提供短命令 `pn` 和完整命令 `pagenest`。

## 功能

- 递归扫描 `.md`、`.markdown`、`.mdown`
- 树形目录与平铺列表两种导航方式，支持标题/路径过滤
- 全文档搜索弹窗，支持标题、路径和正文命中
- 多文档标签、草稿恢复、未保存提示
- 章节收藏与“我的速记”
- 阅读、块级富文本编辑、整篇源码编辑
- 手动保存并自动保留保存前快照
- 历史版本 diff、恢复，以及恢复前自动存档
- 磁盘并发修改检测，冲突时保留本地或加载磁盘版本
- 纸质/夜读主题，桌面、平板和移动端布局

## 环境

- Node.js `>= 20`
- 无运行时依赖

## 快速开始

直接从源码运行：

```bash
cd pagenest
node ./bin/pagenest.js /path/to/notes
```

在当前项目内建立全局命令：

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

| 参数 | 说明 |
| --- | --- |
| `-p, --port <number>` | 监听端口，默认 `4321`；`0` 表示由系统分配 |
| `--host <host>` | 监听地址，默认 `127.0.0.1` |
| `--token [token]` | 启用访问令牌；非本机监听时自动生成 |
| `--open` | 启动后打开浏览器，默认开启 |
| `--no-open` | 不自动打开浏览器 |
| `-h, --help` | 显示帮助 |
| `-v, --version` | 显示版本 |

示例：

```bash
pn ./docs --port 8080 --no-open
pn ./notes --host 0.0.0.0
pagenest ./notes --token my-private-token
```

## 局域网访问

监听 `0.0.0.0`、`::` 或其他非 loopback 地址时，PageNest 会自动生成访问令牌，并在终端打印带 token 的地址。浏览器首次打开该地址后，服务会写入 `HttpOnly`、`SameSite=Strict` Cookie，后续请求不需要在 URL 中重复携带 token。

```bash
pn ./notes --host 0.0.0.0
```

只在可信局域网中使用。访问令牌不能替代 HTTPS、系统防火墙或网络访问控制。

## 文件与历史

Markdown 文件始终是正文内容的唯一数据源。PageNest 不建立数据库。

```text
your-notes/
├── README.md
├── guides/
│   └── start.md
└── .pagenest/
    └── history/
        └── d-<document-id>/
            ├── index.json
            └── v-<version-id>.md
```

- 保存前会把磁盘上的当前版本写入 `.pagenest/history/`。
- 恢复历史版本前，会先为当前正文创建“恢复前自动存档”。
- 每篇文档最多保留 200 个历史版本。
- `.pagenest/`、`.git/`、`node_modules/`、隐藏目录和符号链接不会出现在文档导航中。
- 正文写入使用同目录临时文件加原子重命名，降低中断造成半写文件的风险。

浏览器 `localStorage` 只保存 UI 状态、打开的标签、主题、收藏、导航模式和未保存草稿，键名为 `pagenest.ui.v1`。重要的正文与历史数据都在磁盘上。

## 编辑与保存

- 点击“编辑”，再点击任意正文块进入原地编辑。
- “源码”切换到整篇 Markdown 编辑；两种模式共享同一份未保存内容。
- `Cmd/Ctrl+S` 或“保存”按钮写回磁盘。
- 关闭有未保存修改的标签时，会询问是否保存。
- 保存时使用打开文件时的 SHA-256 哈希校验磁盘版本；若文件已变化，页面会展示冲突处理弹层。

首版不提供重命名、移动和删除。新建文档会直接创建必要的父目录。

## Markdown 范围

当前支持 GFM 子集：

- 标题、段落、粗体、斜体、删除线、链接、图片
- 有序/无序列表、任务列表、引用、代码块、行内代码
- 表格、分隔线

暂不支持公式、Mermaid、内嵌 HTML 和插件。相对路径图片、跨 Markdown 文档链接等资源解析也仍属于后续能力。

## 安全边界

- 默认只监听 `127.0.0.1`。
- 文档路径经过规范化和根目录边界检查，拒绝路径穿越。
- API 写请求校验同源 `Origin`，并支持访问令牌。
- 响应设置 CSP、`X-Content-Type-Options`、`Referrer-Policy` 和 `X-Frame-Options`。
- 首版把 Markdown 文件当作可信本地内容处理；它不是一个面向不可信公网用户的多人 CMS。

## 开发与测试

```bash
npm test
node ./bin/pagenest.js . --no-open
npm pack --dry-run
```

架构、数据流、API 和安全设计见 [TECHNICAL_PLAN.md](./TECHNICAL_PLAN.md)。

## 已知限制

- 没有真实身份系统、协同编辑和权限模型。
- 没有文件监听器；外部改动通过保存冲突和 SSE 事件提示，而不是持续文件监视。
- 版本历史依赖本地 `.pagenest/`，不会自动同步或备份。
- 富文本编辑基于浏览器 `contenteditable`，复杂 Markdown 仍建议使用整篇源码模式。
- `pn` 是高频短命令，`pagenest` 是完整别名；两者行为完全一致。

## License

MIT
