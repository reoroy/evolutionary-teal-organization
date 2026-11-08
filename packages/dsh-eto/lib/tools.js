/**
 * The model-facing half: fourteen tools registered directly on `ctx.tools`.
 *
 * Every tool is a thin declaration around one spawned ETO call (see spawn.js) or
 * one in-process model call (`eto_peer_score`). Three rules shape the
 * declarations:
 *
 * 1. **Names carry no MCP prefix.** The bridge this replaces produced
 *    `mcp__eto__eto_consensus`; these are `eto_consensus`. No compatibility
 *    aliases: a session that still asks for the prefixed name gets "unknown
 *    tool", which is the honest answer.
 * 2. **Failures are thrown, not encoded.** A failed call throws an Error whose
 *    message names the tool, the failure class and the child's own diagnostics,
 *    so the registry turns it into `isError` and the model can act on it. Only
 *    successful results become canonical values.
 * 3. **Output schemas are open objects.** ETO owns its result shapes and evolves
 *    them; requiring the fields this plugin actually uses, with
 *    `additionalProperties` left open, keeps PTC callers typed without turning a
 *    new ETO field into a spurious failure.
 */
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { resolveSettings } from './config.js'
import { persistReview } from './reviews.js'
import { childEnv, runTool } from './spawn.js'

/** Tool names in registration order; the sidebar and status page read this list. */
export const TOOL_NAMES = Object.freeze([
  'eto_consensus',
  'eto_route',
  'eto_peer_config',
  'eto_memory_write',
  'eto_memory_read',
  'eto_memory_list',
  'eto_clarify',
  'eto_review',
  'eto_feedback',
  'eto_file_status',
  'eto_file_update',
  'eto_file_release',
  'agent_execute',
  'eto_peer_score',
])

/** The thirteen tools ETO itself provides; `eto_peer_score` is this plugin's own. */
export const ETO_TOOL_NAMES = Object.freeze(TOOL_NAMES.filter(name => name !== 'eto_peer_score'))

/** Peer names ETO's consensus stitch knows about. */
const PEERS = ['researcher', 'coder', 'auditor']

/** System prompts mirroring ETO's `PEER_SYSTEM_PROMPTS` so scoring matches the stitch. */
const PEER_PROMPTS = {
  researcher: '你是一个研究员。评估这个计划的完整性、可行性和证据充分性。重点关注：方案是否有漏洞、是否有数据支持、是否有替代方案被忽略。',
  coder: '你是一个编码员。评估这个计划的技术可行性、实现难度和潜在技术债务。重点关注：实现路径是否合理、有没有更好的技术方案。',
  auditor: '你是一个审计员。评估这个计划的风险面、潜在失败点和长期影响。重点关注：最坏情况下会怎样、有什么预防措施没考虑。',
}

/** Scoring instruction appended to the peer prompt; the reply must be one JSON object. */
const SCORE_INSTRUCTION = [
  '请对下面的执行计划评分。只输出一个 JSON 对象，不要输出其它文字：',
  '{"score": 0到1之间的小数, "concern": "最关键的疑虑（一句话）", "suggestion": "可执行的改进建议（一句话）"}',
].join('\n')

/** Model-facing text projection: one headline plus the canonical JSON. */
const renderJson = (headline) => (args, value) => [
  { type: 'text', text: `${headline}\n${JSON.stringify(value, null, 2)}` },
]

/** Open object schema requiring the fields this plugin reads. */
const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
})

const string = description => ({ type: 'string', description })
const number = description => ({ type: 'number', description })
const boolean = description => ({ type: 'boolean', description })
const stringArray = description => ({ type: 'array', items: { type: 'string' }, description })
const anyJson = description => ({ description })

/**
 * Turn one SpawnResult failure into the thrown error the registry reports.
 * @param {string} tool
 * @param {import('./spawn.js').SpawnResult} result
 * @returns {Error}
 */
function failureOf(tool, result) {
  const error = result.error ?? { type: 'unknown', message: 'no failure detail' }
  const facts = [error.type, result.timedOut ? 'timed out' : null, result.signal ? `signal ${result.signal}` : null, result.exitCode === null ? null : `exit ${result.exitCode}`]
    .filter(Boolean)
    .join(', ')
  return new Error(`${tool} failed (${facts}): ${error.message}`)
}

/**
 * Run one `eto_consensus` and persist its record to the review ledger. This is
 * the single shared path for every way a consensus can be triggered: the
 * model-facing tool, the workbench `/run` route, and the virtual provider.
 *
 * A successful result is always written to `~/.eto/reviews/` (best-effort: a
 * lost write never turns a real consensus into a tool error), and a failed
 * run throws the same locatable error the tool path already reports.
 *
 * @param {object} options
 * @param {() => object} options.settings - resolves the current settings snapshot.
 * @param {import('@deepseek-ai/cordis').Context} options.ctx - plugin context (logging).
 * @param {object} options.args - tool arguments (plan, peers).
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {NodeJS.ProcessEnv} [options.env] - child environment override.
 * @returns {Promise<object>} the consensus value ETO returned.
 */
export async function runConsensus({ settings, ctx, args, signal, env }) {
  const plan = typeof args.plan === 'string' ? args.plan.trim() : ''
  const started = Date.now()
  const result = await runTool({ settings: settings(), tool: 'eto_consensus', args, signal, env })
  if (!result.ok) throw failureOf('eto_consensus', result)
  const value = result.value
  const written = persistReview({
    at: new Date(started).toISOString(),
    plan,
    elapsedMs: result.durationMs ?? (Date.now() - started),
    ...value,
  })
  if (!written.ok) ctx.logger?.warn?.(`dsh-eto: could not persist consensus review: ${written.error}`)
  return value
}

/**
 * Run one `eto_route` classification (three-mirror routing). The virtual
 * provider uses this as the gate: `direct` delegates to a real model, while
 * `plan` / `consensus` proceed to the fused peer review. No persistence — this
 * is the read-only classifier, not the review itself.
 *
 * @param {object} options
 * @param {() => object} options.settings - resolves the current settings snapshot.
 * @param {object} options.args - tool arguments (task).
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {NodeJS.ProcessEnv} [options.env] - child environment override.
 * @returns {Promise<object>} the route ETO returned ({ gewu, route, confidence }).
 */
export async function runRoute({ settings, args, signal, env }) {
  const result = await runTool({ settings: settings(), tool: 'eto_route', args, signal, env })
  if (!result.ok) throw failureOf('eto_route', result)
  return result.value
}

/**
 * Build the tool definitions for one plugin instance.
 * @param {object} options
 * @param {import('@deepseek-ai/cordis').Context} options.ctx - plugin context.
 * @param {() => object} options.settings - resolves the current settings snapshot.
 * @returns {Array<object>} tool definitions for `ctx.tools.register()`.
 */
export function createTools({ ctx, settings }) {
  /**
   * The plugin's own HTTP API base (http://127.0.0.1:<port>/@dsh-eto/api), set by apply()'s
   * webServer injection. Runners reach it as ETO_DSH_ENDPOINT so consensus peers can vote through
   * the host's LLM service (per-peer providers) instead of one local model for all of them.
   */
  let dshEndpoint = null
  const setDshEndpoint = url => { if (url) dshEndpoint = url }
  /** Env for a spawned ETO call that may reach back into the host's /llm endpoint. */
  const consensusEnv = () => {
    const snapshot = settings()
    const base = childEnv(snapshot, process.env)
    // The peers travel as ONE structured JSON env var, produced by the settings schema rather
    // than by a hand-maintained file: whatever the panel saved is exactly what vote.py receives.
    // Only complete rows travel to vote.py; a row kept in settings so the editor can show a
    // half-filled choice must not become a peer that would be called with an empty model.
    const peers = (Array.isArray(snapshot.peers) ? snapshot.peers : [])
      .filter(entry => entry && entry.provider && entry.model)
    if (peers.length > 0) base.ETO_PEERS_JSON = JSON.stringify(peers)
    if (snapshot.ollamaRemote) base.ETO_OLLAMA_REMOTE = snapshot.ollamaRemote
    return dshEndpoint ? { ...base, ETO_DSH_ENDPOINT: dshEndpoint } : base
  }
  const api = { setDshEndpoint, consensusEnv }

  /** Run one ETO tool through the child process and unwrap its value. */
  const call = async (tool, args, exec) => {
    const result = await runTool({ settings: settings(), tool, args, signal: exec.signal, env: consensusEnv() })
    if (!result.ok) throw failureOf(tool, result)
    return result.value
  }

  const eto = (tool, options) => ({
    name: tool,
    description: options.description,
    parameters: options.parameters,
    output: {
      schema: options.schema,
      render: options.render ?? renderJson(`${tool}:`),
    },
    async execute(args, exec) {
      return options.execute ? options.execute(args, exec) : call(tool, args, exec)
    },
  })

  const tools = [
    eto('eto_consensus', {
      description: 'ETO 同侪共识。默认 review 模式：对执行计划做评分→审议→终审三阶段，返回 status / final_score / votes / deliberation / actions。mode="advise" 为会诊模式：不评分，返回 synthesis / advice / risks / disagreements，主模型可直接采用。默认 peer 为 researcher、coder、auditor，评分走 ETO 配置的 provider（可能是 Ollama，慢时请设更长超时）。',
      parameters: objectSchema({
        plan: string('要评审或会诊的执行计划全文'),
        peers: stringArray('可选 peer 列表，默认 researcher/coder/auditor'),
        mode: string('advise（建议/分歧/风险，不含评分，默认）或 review（评分卡，仅面板历史用）'),
      }, ['plan']),
      schema: objectSchema({
        status: string('approved | revise | reject'),
        final_score: number('最终分数 0-1'),
        votes: { type: 'array', items: { description: '单个 peer 的评分' }, description: '各 peer 评分' },
        deliberation: { type: 'object', description: '审议与终审记录', additionalProperties: true },
        actions: { type: 'array', items: { description: '行动项' }, description: '终审给出的行动项' },
      }, ['status', 'final_score', 'votes']),
      render: (args, value) => [{
        type: 'text',
        text: value?.mode === 'advise'
          ? `eto_consensus: ${value.synthesis ?? '（无有效建议）'}\n${JSON.stringify(value, null, 2)}`
          : `eto_consensus: ${value.status} (score ${value.final_score})\n${JSON.stringify(value, null, 2)}`,
      }],
      // Persist the review for the panel ledger the moment it completes. This is
      // best-effort: a lost write must never turn a real consensus into a tool
      // error. The result the model sees is unchanged — only the ledger gains a
      // record (audit_id, plan, elapsed time) beside ETO's own result shape.
      execute: (args, exec) => runConsensus({ settings, ctx, args, signal: exec.signal, env: consensusEnv() }),
    }),

    eto('eto_route', {
      description: 'ETO 三镜路由：判断任务属于 knowledge/research/code/solution，给出 direct/plan/consensus 路由与置信度。',
      parameters: objectSchema({ task: string('任务描述') }, ['task']),
      schema: objectSchema({
        gewu: string('knowledge | research | code | solution'),
        route: string('direct | plan | consensus'),
        confidence: number('置信度 0-1'),
      }, ['gewu', 'route', 'confidence']),
      render: (args, value) => [{
        type: 'text',
        text: `eto_route: ${value.gewu} → ${value.route} (confidence ${value.confidence})\n${JSON.stringify(value, null, 2)}`,
      }],
    }),

    eto('eto_peer_config', {
      description: '读取 ETO 的 peer provider 配置（来自 ~/.pi/eto-config.json，缺省为 Ollama）。',
      parameters: objectSchema({}),
      schema: objectSchema({ peers: { type: 'object', description: 'peer 名 → provider/model', additionalProperties: true } }, ['peers']),
    }),

    eto('eto_memory_write', {
      description: '写一条 ETO 共享记忆（跨会话 KV，其他 agent 可读）。value_json 是 JSON 字符串；不是合法 JSON 时按 {"text": 原文} 存。',
      parameters: objectSchema({
        key: string('记忆 key'),
        value_json: string('要存的值，JSON 字符串'),
      }, ['key', 'value_json']),
      schema: objectSchema({ written: string('写入的 key') }, ['written']),
    }),

    eto('eto_memory_read', {
      description: '读一条 ETO 共享记忆；key 不存在时返回 {"missing": key}。',
      parameters: objectSchema({ key: string('记忆 key') }, ['key']),
      schema: anyJson('记忆值（形状由写入方决定）或 {"missing": key}'),
    }),

    eto('eto_memory_list', {
      description: '列出 ETO 共享记忆的 key（可按子串过滤）。',
      parameters: objectSchema({ pattern: string('可选子串过滤') }),
      schema: { type: 'array', items: { type: 'string' }, description: '匹配的 key 列表' },
    }),

    eto('eto_clarify', {
      description: '检测任务指令是否模糊；模糊时返回 matched 命中词与 suggestions 澄清选项，否则 {"vague": false}。',
      parameters: objectSchema({ task: string('任务描述') }, ['task']),
      schema: objectSchema({
        vague: boolean('是否模糊'),
        task: string('原任务'),
        matched: stringArray('命中的模糊词'),
        suggestions: stringArray('澄清建议'),
      }, ['vague']),
    }),

    eto('eto_review', {
      description: '审查 sub-agent 返回结果，给出结构化摘要（agent、summary、raw_length）。result_json 必须是合法 JSON。',
      parameters: objectSchema({
        agent: string('产出该结果的 agent 名'),
        result_json: string('待审查结果的 JSON 字符串'),
      }, ['agent', 'result_json']),
      schema: objectSchema({
        agent: string('agent 名'),
        summary: anyJson('关键点摘要'),
        raw_length: number('原文字符数'),
      }, ['agent', 'summary']),
    }),

    eto('eto_feedback', {
      description: '把用户反馈保存为 routing 约束，ETO 下次 dispatch 时自动注入。',
      parameters: objectSchema({
        agent: string('约束归属的 agent'),
        constraint: string('约束内容'),
      }, ['agent', 'constraint']),
      schema: objectSchema({
        saved: boolean('是否保存成功'),
        agent: string('agent 名'),
        constraint: string('约束内容'),
      }, ['saved']),
    }),

    eto('eto_file_status', {
      description: '查询文件的 ETO 编辑状态（多 agent 协调用）；无人持有时返回 null。',
      parameters: objectSchema({ file: string('文件路径') }, ['file']),
      schema: {
        oneOf: [
          { type: 'null' },
          objectSchema({
            file: string('文件路径'),
            editor: string('当前编辑者'),
            ts: number('发布时间戳'),
          }, ['file', 'editor']),
        ],
        description: '文件锁状态或 null',
      },
    }),

    eto('eto_file_update', {
      description: '发布文件编辑状态（多 agent 协调），返回 {status, file, editor, ts}。',
      parameters: objectSchema({
        file: string('文件路径'),
        editor: string('编辑者标识，默认 default'),
        file_hash: string('可选内容哈希'),
      }, ['file']),
      schema: objectSchema({
        status: string('ok'),
        file: string('文件路径'),
        editor: string('编辑者'),
        ts: number('时间戳'),
      }, ['status', 'file', 'editor']),
    }),

    eto('eto_file_release', {
      description: '解除文件的 ETO 编辑锁；返回是否真的解除了。',
      parameters: objectSchema({ file: string('文件路径') }, ['file']),
      schema: objectSchema({ released: boolean('是否解除') }, ['released']),
    }),

    eto('agent_execute', {
      description: '把一步任务路由给 ETO 配置的 peer provider（ollama/deepseek/claude/mcp）执行，返回 {status, agent, output}。provider 不可用或返回空时抛错，不会假装成功。',
      parameters: objectSchema({
        task: string('要执行的任务'),
        system: string('可选 system prompt'),
        skills: stringArray('可选 skills 名列表'),
        mcp_tools: stringArray('可选 MCP 工具名列表'),
      }, ['task']),
      schema: objectSchema({
        status: string('ok'),
        agent: string('执行的 peer'),
        output: string('模型输出'),
      }, ['status', 'agent', 'output']),
    }),

    {
      name: 'eto_peer_score',
      description: '用当前会话的模型给计划打分（不依赖 Ollama），并把结果写回 ETO 共享记忆的 peer_score:<peer>。默认用会话模型，可在设置面板指定 provider/model。',
      parameters: objectSchema({
        plan: string('要评分的执行计划'),
        peer: { type: 'string', enum: PEERS, description: '以哪个 peer 的视角评分，默认 coder' },
      }, ['plan']),
      output: {
        schema: objectSchema({
          peer: string('评分视角'),
          provider: string('实际使用的 provider route'),
          model: string('实际使用的 model id'),
          score: number('0-1'),
          concern: string('最关键的疑虑'),
          suggestion: string('改进建议'),
          routeSource: string('settings | session：模型路由来自哪里'),
          stored: boolean('是否已写回 ETO 共享记忆'),
          latencyMs: number('模型调用耗时'),
        }, ['peer', 'provider', 'model', 'score', 'stored']),
        render: (args, value) => [{
          type: 'text',
          text: `eto_peer_score: ${value.peer} scored ${value.score} via ${value.provider}/${value.model}`
            + `${value.concern ? `\nconcern: ${value.concern}` : ''}`
            + `${value.suggestion ? `\nsuggestion: ${value.suggestion}` : ''}`
            + `${value.stored ? '\n(stored to ETO shared memory)' : ''}`,
        }],
      },
      async execute(args, exec) {
        return scoreWithSessionModel({ ctx, settings: settings(), args, exec, call })
      },
    },
  ]
  return { tools, dsh: api }
}

/**
 * Resolve the route `eto_peer_score` should use: the settings override when both
 * halves are present, else the model the calling session is actually on.
 * @param {object} settings - resolved plugin settings.
 * @param {object | undefined} agent - calling agent, if any.
 * @returns {{ provider: string, model: string, source: string }}
 */
export function resolveScoreRoute(settings, agent) {
  const overrideProvider = (settings.peerScoreProvider ?? '').trim()
  const overrideModel = (settings.peerScoreModel ?? '').trim()
  if (overrideProvider !== '' && overrideModel !== '') {
    return { provider: overrideProvider, model: overrideModel, source: 'settings' }
  }
  const header = agent?.session?.requestHeader?.()?.config
  const provider = header?.provider ?? agent?.options?.provider
  const model = header?.model ?? agent?.options?.model
  if (typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== '') {
    return { provider, model, source: 'session' }
  }
  throw new Error(
    'eto_peer_score: no model route could be resolved — this session has no request header yet and the plugin settings name no peerScoreProvider/peerScoreModel',
  )
}

/**
 * Score one peer from a panel request, where no `exec.agent` exists.
 *
 * The panel cannot inherit the session's route (it is a bare HTTP handler), so the caller must
 * name a provider/model explicitly — that is the documented requirement for consensus-from-panel.
 * Returns the RAW model text: ETO's own `_score_single` parses it, so this endpoint never has to
 * agree with ETO about the reply shape.
 *
 * Throws (never returns a default score): a silent 0.5 here is exactly the "fake success" the
 * consensus path is being fixed for.
 */
/**
 * One thin LLM call through the host's routing — the virtual-provider surface ETO's consensus
 * votes through when a peer names `provider: "dsh"`. No scoring semantics: ETO owns the prompt
 * and parses the reply; this is just the pipe. Every route is local-only and header-guarded.
 */
export async function callLlmRaw({ ctx, provider, model, system = '', prompt, maxTokens = 1024, timeoutMs = 120_000 }) {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('the llm service is not composed in this host; cannot route the call')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`llm call exceeded ${timeoutMs} ms`)), timeoutMs)
  timer.unref?.()
  try {
    const assembler = new BlockAssembler()
    const stream = llm.stream({
      provider,
      model,
      ...(system ? { system } : {}),
      messages: [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: 'dsh-eto' },
      })],
      maxTokens,
      signal: controller.signal,
    })
    for await (const chunk of stream) assembler.push(chunk)
    const finish = assembler.finish
    if (finish !== undefined && finish.kind === 'error') {
      throw new Error(`llm call failed on ${provider}/${model}: ${finish.error?.message ?? 'stream error'}`)
    }
    const text = assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('')
    if (text.trim() === '') throw new Error(`llm call returned no text (provider ${provider}/${model})`)
    return text
  } finally { clearTimeout(timer) }
}

export async function scorePeerText({ ctx, provider, model, peer, plan, timeoutMs = 90_000, signal }) {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('the llm service is not composed in this host; cannot score from the panel')
  const system = PEER_PROMPTS[peer] ?? PEER_PROMPTS.coder
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`panel peer score exceeded ${timeoutMs} ms`)), timeoutMs)
  if (signal !== undefined) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  timer.unref?.()
  try {
    const assembler = new BlockAssembler()
    const stream = llm.stream({
      provider,
      model,
      system,
      messages: [createUserMessage({
        content: [{ type: 'text', text: `${SCORE_INSTRUCTION}\n\n计划:\n${plan}` }],
        source: { kind: 'plugin', plugin: 'dsh-eto' },
      })],
      maxTokens: 800,
      signal: controller.signal,
    })
    for await (const chunk of stream) assembler.push(chunk)
    const finish = assembler.finish
    if (finish !== undefined && finish.kind === 'error') {
      throw new Error(`panel peer score failed on ${provider}/${model}: ${finish.error?.message ?? 'stream error'}`)
    }
    const text = assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('')
    if (text.trim() === '') throw new Error(`panel peer score returned no text (provider ${provider}/${model})`)
    return text
  } finally { clearTimeout(timer) }
}

/**
 * Pull the first JSON object out of a model reply, tolerating a ```json fence.
 * @param {string} text
 * @returns {object | null}
 */
export function extractScoreObject(text) {
  const source = String(text ?? '')
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(source)
  const candidates = fenced ? [fenced[1], source] : [source]
  for (const candidate of candidates) {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end <= start) continue
    try {
      const value = JSON.parse(candidate.slice(start, end + 1))
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value
    } catch {
      // try the next candidate
    }
  }
  return null
}

/** Normalize one model reply into the tool's canonical score value. */
function scoreValue(raw, route) {
  const parsed = extractScoreObject(raw)
  if (parsed === null) {
    throw new Error(`eto_peer_score: the model reply contained no JSON object (provider ${route.provider}/${route.model}); first 200 chars: ${String(raw).slice(0, 200)}`)
  }
  const score = Number(parsed.score)
  if (!Number.isFinite(score)) {
    throw new Error(`eto_peer_score: model reply has no numeric "score" (got ${JSON.stringify(parsed.score)})`)
  }
  return {
    score: Math.min(Math.max(score, 0), 1),
    concern: typeof parsed.concern === 'string' ? parsed.concern.slice(0, 400) : '',
    suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion.slice(0, 400) : '',
  }
}

/**
 * Run `eto_peer_score`: one in-process model call on the session's route, then a
 * write-back to ETO's shared memory so the score joins the other peer scores.
 */
async function scoreWithSessionModel({ ctx, settings, args, exec, call }) {
  const plan = typeof args.plan === 'string' ? args.plan.trim() : ''
  if (plan === '') throw new Error('eto_peer_score: 缺少必填参数 plan（要评分的执行计划）')
  const peer = typeof args.peer === 'string' && PEERS.includes(args.peer) ? args.peer : 'coder'
  const llm = ctx.get('llm')
  if (llm === undefined) {
    throw new Error('eto_peer_score: the llm service is not composed in this host; cannot score with the session model')
  }
  const route = resolveScoreRoute(settings, exec.agent)

  const controller = new AbortController()
  const onAbort = () => controller.abort(exec.signal.reason)
  if (exec.signal.aborted) controller.abort(exec.signal.reason)
  else exec.signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error(`eto_peer_score exceeded ${settings.peerScoreTimeoutMs} ms`)), settings.peerScoreTimeoutMs)
  timer.unref?.()

  const started = Date.now()
  let text = ''
  try {
    const assembler = new BlockAssembler()
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: PEER_PROMPTS[peer],
      messages: [createUserMessage({
        content: [{ type: 'text', text: `${SCORE_INSTRUCTION}\n\n计划:\n${plan}` }],
        source: { kind: 'plugin', plugin: 'dsh-eto' },
      })],
      maxTokens: 800,
      signal: controller.signal,
    })
    for await (const chunk of stream) assembler.push(chunk)
    const finish = assembler.finish
    if (finish !== undefined && finish.kind === 'error') {
      throw new Error(`eto_peer_score: model call failed (${finish.failure.code}): ${finish.failure.message}`)
    }
    if (finish !== undefined && finish.kind === 'aborted') {
      throw new Error(`eto_peer_score: model call aborted (${finish.failure?.code ?? 'ABORTED'}): ${finish.failure?.message ?? 'no reason reported'}`)
    }
    text = assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
  } finally {
    clearTimeout(timer)
    exec.signal.removeEventListener('abort', onAbort)
  }

  const scored = scoreValue(text, route)
  const latencyMs = Date.now() - started
  const record = {
    type: 'peer_score',
    peer,
    score: scored.score,
    concern: scored.concern,
    provider: route.provider,
    model: route.model,
    source: 'dsh-session-model',
    ts: Date.now() / 1000,
  }

  // Write-back is best-effort by design: a scoring result the model can use is
  // worth more than a failed call, but `stored` tells the truth either way.
  let stored = false
  try {
    const written = await runTool({
      settings,
      tool: 'eto_memory_write',
      args: { key: `peer_score:${peer}`, value_json: JSON.stringify(record) },
      signal: exec.signal,
    })
    stored = written.ok === true
    if (!stored) ctx.logger?.warn?.(`dsh-eto: eto_peer_score could not store ${peer}: ${written.error?.message ?? 'unknown'}`)
  } catch (error) {
    ctx.logger?.warn?.(`dsh-eto: eto_peer_score write-back failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  return {
    peer,
    provider: route.provider,
    model: route.model,
    routeSource: route.source,
    score: scored.score,
    concern: scored.concern,
    suggestion: scored.suggestion,
    stored,
    latencyMs,
  }
}
