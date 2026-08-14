/**
 * dsh-vision-tools — DeepSeek Harness 视觉能力全家桶（宿主半区）
 *
 * 在一个 bundle 插件里同时提供：
 *   1. vision_understand 工具：调用 OpenAI 兼容视觉大模型 API 理解本地图片，
 *      弥补 DeepSeek 无视觉能力的短板（配置见 README 的 vision.env 部分）。
 *   2. POST /api/vision-paste 路由：浏览器端把粘贴/拖拽的图片落盘到
 *      $DSH_HOME/pasted-images/，返回路径供模型读取。
 *
 * 配置读取顺序（vision_understand 工具）：
 *   1. $DSH_HOME/vision.env （推荐，全局生效）
 *   2. ~/.dsh/vision.env
 *   3. <cwd>/.dsh-vision.env （工作区回退）
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve as pathResolve, isAbsolute } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------- 工具部分

const PRESETS = {
  zhipu: { base: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4v-flash' },
  dashscope: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-vl-plus' },
  siliconflow: { base: 'https://api.siliconflow.cn/v1/chat/completions', model: 'Qwen/Qwen2.5-VL-7B-Instruct' },
  openai: { base: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
}

const MAX_BYTES = 20 * 1024 * 1024

function parseEnv(text) {
  const cfg = {}
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    let v = line.slice(eq + 1).trim()
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1)
    cfg[line.slice(0, eq).trim()] = v
  }
  return cfg
}

async function readConfig() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const candidates = [
    join(dshHome, 'vision.env'),
    join(homedir(), '.dsh', 'vision.env'),
    join(process.cwd(), '.dsh-vision.env'),
  ]
  let text = null
  let found = null
  for (const p of candidates) {
    try {
      text = await readFile(p, 'utf8')
      found = p
      break
    } catch {
      // try next candidate
    }
  }
  if (text === null || found === null) {
    throw new Error('未找到视觉 API 配置文件。请创建 ' + candidates[0] + '（推荐，全局生效）或 ' + candidates[2] + '，内容格式：\nVISION_PROVIDER=zhipu\nVISION_API_KEY=你的Key')
  }
  const cfg = parseEnv(text)
  if (!cfg.VISION_API_KEY || !cfg.VISION_API_KEY.trim()) {
    throw new Error('配置文件 ' + found + ' 缺少 VISION_API_KEY=xxx')
  }
  const provider = (cfg.VISION_PROVIDER || 'zhipu').trim()
  const preset = PRESETS[provider] || PRESETS.zhipu
  return {
    key: cfg.VISION_API_KEY.trim(),
    endpoint: (cfg.VISION_BASE_URL || preset.base).trim(),
    model: (cfg.VISION_MODEL || preset.model).trim(),
    provider,
    file: found,
  }
}

function mimeFor(path) {
  const ext = (String(path).split('.').pop() || '').toLowerCase()
  const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' }
  return map[ext] || 'image/png'
}

async function loadImageBytes(rawPath) {
  const candidates = [rawPath]
  if (!isAbsolute(rawPath)) {
    candidates.unshift(pathResolve(process.cwd(), rawPath))
  }
  let lastErr = null
  for (const p of candidates) {
    try {
      const bytes = await readFile(p)
      if (bytes.byteLength > MAX_BYTES) {
        throw new Error('图片超过 20MB 上限：' + p)
      }
      return { bytes, path: p }
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error('无法读取图片文件 ' + rawPath + '：' + String((lastErr && lastErr.message) || lastErr))
}

// ------------------------------------------------------------ 粘贴路由部分

async function registerPasteRoute(ctx) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const dir = join(dshHome, 'pasted-images')
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/vision-paste',
    handler: (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > 40 * 1024 * 1024) req.destroy(new Error('payload too large'))
      })
      req.on('error', () => {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: '读取请求体失败' }))
      })
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body)
          const name = String((payload && payload.name) || 'pasted.png').replace(/[^\w.\-]/g, '_').slice(0, 60)
          const base64 = String((payload && payload.base64) || '')
          if (!base64) throw new Error('缺少图片数据')
          await mkdir(dir, { recursive: true })
          const abs = join(dir, Date.now() + '-' + name)
          await writeFile(abs, Buffer.from(base64, 'base64'))
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ path: abs }))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: String((e && e.message) || e) }))
        }
      })
    },
  })
  console.log('[dsh-vision-tools] 路由 /api/vision-paste 已注册（保存目录：' + dir + '）')
}

// -------------------------------------------------------------------- 插件

export default {
  name: 'dsh-vision-tools',
  inject: ['tools', 'webServer'],
  apply(ctx) {
    const tool = defineTool({
      name: 'vision_understand',
      description: '调用外部视觉大模型理解一张本地图片（描述画面内容、识别文字、回答问题），弥补当前模型无视觉能力的短板。image_path 为图片文件的本地路径（建议传绝对路径，支持 png/jpg/webp/gif 等），prompt 为可选的提问，默认描述整张图片。需要配置文件（~/.dsh/vision.env 或工作区 .dsh-vision.env）提供 VISION_API_KEY。',
      parameters: {
        image_path: { type: 'string', description: '本地图片文件的路径（绝对路径，或相对 DSH 启动目录的路径）', required: true },
        prompt: { type: 'string', description: '对图片的提问；省略时默认：请详细描述这张图片的内容，包括其中可见的文字。' },
      },
      output: {
        schema: { type: 'object', properties: { text: { type: 'string', required: true } }, additionalProperties: false },
        render: (args, value) => [{ type: 'text', text: value.text }],
      },
      timeoutMs: 150000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const cfg = await readConfig()
        const { bytes, path } = await loadImageBytes(args.image_path)
        const prompt = (typeof args.prompt === 'string' && args.prompt.trim())
          ? args.prompt.trim()
          : '请详细描述这张图片的内容，包括其中可见的文字。'
        const payload = {
          model: cfg.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: 'data:' + mimeFor(path) + ';base64,' + Buffer.from(bytes).toString('base64') } },
            ],
          }],
          max_tokens: 1024,
        }
        let res
        try {
          res = await fetch(cfg.endpoint, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + cfg.key,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: exec.signal,
          })
        } catch (e) {
          throw new Error('请求视觉 API 失败（' + cfg.provider + '）：' + String((e && e.message) || e))
        }
        const raw = await res.text()
        if (!res.ok) {
          throw new Error('视觉 API 报错 HTTP ' + res.status + '（' + cfg.provider + '）：' + raw.slice(0, 1200))
        }
        let data
        try {
          data = JSON.parse(raw)
        } catch (e) {
          throw new Error('视觉 API 返回了无法解析的内容：' + raw.slice(0, 500))
        }
        if (data && data.error) {
          throw new Error('视觉 API 报错：' + JSON.stringify(data.error).slice(0, 800))
        }
        const choice = data && data.choices && data.choices[0]
        let text = choice && choice.message && choice.message.content
        if (Array.isArray(text)) text = text.map((p) => (p && typeof p.text === 'string') ? p.text : '').join('')
        if (typeof text !== 'string' || !text.trim()) {
          throw new Error('视觉 API 未返回有效内容：' + JSON.stringify(data).slice(0, 500))
        }
        return { text: text.trim() }
      },
    })
    ctx.effect(() => ctx.tools.register(tool))
    console.log('[dsh-vision-tools] vision_understand 工具已注册（全局）')

    ctx.effect(() => registerPasteRoute(ctx))
  },
}
