# dsh-vision-tools

DeepSeek Harness（DSH）视觉能力全家桶 —— 让 DeepSeek 纯文本模型"看得见"。

- **vision_understand 工具**：调用 OpenAI 兼容视觉大模型 API 理解本地图片（描述画面、识别文字、回答问题），注册为全局工具，所有会话可用。
- **三入口识图**：`Cmd/Ctrl+V` 粘贴截图、拖图到按钮、点按钮选文件 → 图片自动落盘到 `$DSH_HOME/pasted-images/` → 输入框填入 `请识别这张图片：<路径>` → 发送后模型自动调用识图工具。

默认使用**智谱 GLM-4.6V-Flash（免费）**，支持 4 家 provider 切换。被限流时**自动降级到 GLM-4V（glm-4v-flash）**重试，免费模型高峰期也不容易失败。

## 安装

```sh
# 方式一：npm 安装（推荐）
dsh plugin --profile web add dsh-vision-tools

# 方式二：GitHub 安装
dsh plugin --profile web add "github:moon09300731/dsh-vision-tools#main"
```

重启 `dsh web` 后生效。

## 配置（vision_understand 工具需要）

创建 `~/.dsh/vision.env`（全局生效，推荐）：

```env
VISION_PROVIDER=zhipu        # zhipu | dashscope | siliconflow | openai
VISION_API_KEY=你的APIKey
```

可选覆盖：

```env
VISION_BASE_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
VISION_MODEL=glm-4.6v-flash
```

限流自动降级（可选）：

```env
VISION_FALLBACK_MODEL=glm-4v-flash
```

- 主模型 `VISION_MODEL` 被限流（HTTP 429 / 负载过高 / 频率限制等）时，自动降级到 `VISION_FALLBACK_MODEL` 重试一次
- 缺省降级模型 = provider 预设模型（`zhipu` → `glm-4v-flash`，即 v4 版本）；主模型与降级模型相同时不会重复请求
- 仅限流类错误触发降级；密钥无效、参数错误等业务错误不降级，直接报错

| provider | 默认模型 | 说明 |
|---|---|---|
| `zhipu` | `glm-4.6v-flash` | 智谱，免费（128K 上下文，支持思考模式） |
| `dashscope` | `qwen-vl-plus` | 阿里百炼 |
| `siliconflow` | `Qwen/Qwen2.5-VL-7B-Instruct` | 硅基流动 |
| `openai` | `gpt-4o-mini` | OpenAI |

工作区回退：在项目目录放 `.dsh-vision.env`（同格式），仅该项目生效。配置每次调用实时读取，改完无需重启。

## 使用

1. **粘贴**：直接 `Cmd/Ctrl+V` 粘贴剪贴板截图（捕获阶段拦截，优先于 GUI 自身附件处理）
2. **拖拽**：拖图片到输入框左侧的「📷 识图」按钮
3. **选择**：点「📷 识图」按钮选文件

发送后 agent 会自动调用 `vision_understand` 识别图片。

## 安全边界

- 图片会**经外部视觉 API 出网**（base64 传输），敏感数据请改用本地 OCR（tesseract/paddleocr），或自建内网视觉服务用 `VISION_BASE_URL` 指向
- `vision.env` 含 API Key，**不要提交到 git**（本仓库 .gitignore 已忽略）
- 粘贴路由仅监听 DSH 本机端口，图片保存于 `$DSH_HOME/pasted-images/`

## 技术说明

> ⚠️ **依赖约定**：`@deepseek-ai/dsh-tools` 是 DSH 宿主运行时自带（bundle 机制提供），本插件**不声明为 dependencies**。若声明，`dsh plugin add` 触发 npm install 会在 profile 里装出第二份 dsh-tools，与宿主全局那份形成**模块双实例**，导致工具执行层 `scheduler.prepare` 崩溃（`Cannot read properties of undefined (reading 'prepare')`）。安装后建议确认 profile 的 `node_modules/@deepseek-ai/dsh-tools` 是符号链接或单实例。

- 宿主半区：`src/index.mjs`（Cordis 插件，`inject: ['tools', 'webServer']`）
  - `vision_understand` 工具经 `defineTool` 注册（`@deepseek-ai/dsh-tools`）
  - `POST /api/vision-paste` 路由落盘粘贴图片
- 浏览器半区：`lib/client.bundle.js`（手写 `__ModuleLoader__` bundle，零构建依赖）
  - `conversation.input.left` slot 注册「📷 识图」按钮
  - 捕获阶段 `paste` 监听拦截剪贴板图片

## License

MIT
