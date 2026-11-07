/**
 * ETO as a virtual LLM provider — an explicit "review this plan" surface, not a
 * session main model.
 *
 * Selecting `eto / eto-consensus` routes each turn through `eto_route` first:
 * a `direct` turn (ordinary question) is delegated to a real model untouched;
 * only `plan` / `consensus` turns open vote.py's three-source heterogeneous
 * consensus and stream the fused conclusion back through the harness LLM
 * contract. ETO is the consultation layer — execution stays with the harness.
 *
 * The fusion lives in `eto/stitches/consensus/vote.py`; this module is only the
 * adapter layer. It runs the consensus through the same
 * `runTool({ tool: 'eto_consensus' })` channel the tool uses, so there is
 * exactly one fusion implementation and one persistence path.
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { runConsensus, runRoute } from './tools.js'

/** Provider route id; the model picker shows this as the provider name. */
export const ETO_PROVIDER = 'eto'
/** The one model this provider advertises. */
export const ETO_MODEL = 'eto-consensus'

/** Advertised context window: the smallest peer (local qwen3-8b ≈ 32k) is the real limit. */
const CONTEXT_WINDOW = 32_768
/** Default output budget: a short fusion conclusion plus a little structure. */
const DEFAULT_MAX_TOKENS = 2_048
/** The three peers vote.py fuses by default; keep in sync with the stitch. */
const PEERS = ['researcher', 'coder', 'auditor']

/** Fallback delegate route when the setting is blank: "provider/model". */
const DEFAULT_DELEGATE = { provider: 'deepseek-official', model: 'deepseek-flash' }

/** Split a `provider/model` delegate setting into its two halves. */
export function parseDelegateRoute(value) {
  const text = String(value ?? '').trim()
  if (text === '') return { ...DEFAULT_DELEGATE }
  const slash = text.indexOf('/')
  if (slash === -1) return { provider: DEFAULT_DELEGATE.provider, model: text }
  return { provider: text.slice(0, slash), model: text.slice(slash + 1) }
}

/** Rough token estimate for usage reporting (chars ÷ 4). */
const estimateTokens = text => Math.max(1, Math.ceil(String(text ?? '').length / 4))

/** Extract the last user message's text content, in message order. */
function lastUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const text = (Array.isArray(message.content) ? message.content : [])
      .filter(block => block?.type === 'text')
      .map(block => String(block.text ?? ''))
      .join('\n')
      .trim()
    if (text !== '') return text
  }
  return ''
}

/** One source label for a vote: provider/model, with the model when present. */
function sourceLabel(source) {
  const provider = String(source?.provider ?? '?')
  const model = String(source?.model ?? '')
  return model ? `${provider}/${model}` : provider
}

/** Whether the plan explicitly asks for the full JSON result. */
function wantsFullResult(plan, settings) {
  return String(plan ?? '').includes('完整结果') || settings?.includeFullResult === true
}

/** Render the consensus value into the streamed reply text (answer-first). */
export function renderConsensus(value, { full = false } = {}) {
  const record = value ?? {}
  const votes = Array.isArray(record.votes) ? record.votes : []
  const usable = votes.filter(vote => vote && typeof vote.score === 'number')
  const score = typeof record.final_score === 'number' ? record.final_score : null
  const distinct = record.fusion && typeof record.fusion.distinct_providers === 'number'
    ? record.fusion.distinct_providers
    : null

  // Answer first (C): the usable conclusion leads; the scorecard goes last.
  const lines = []
  const synthesis = typeof record.synthesis === 'string' && record.synthesis.trim() !== '' ? record.synthesis.trim() : ''
  lines.push(synthesis !== '' ? synthesis : String(record.status ?? 'degraded'))
  if (Array.isArray(record.actions) && record.actions.length > 0) {
    lines.push('', '行动项：')
    for (const action of record.actions) lines.push(`- ${String(action)}`)
  }
  if (votes.length > 0) {
    lines.push('', '分歧与依据：')
    for (const vote of votes) {
      const peer = String(vote?.peer ?? '?')
      const label = sourceLabel({ provider: vote?.provider, model: vote?.model })
      const s = typeof vote?.score === 'number' ? vote.score.toFixed(2) : '无有效分'
      const concern = typeof vote?.concern === 'string' && vote.concern.trim() !== '' ? ` — ${vote.concern.trim()}` : ''
      lines.push(`- ${peer} [${label}] ${s}${concern}`)
    }
  }
  const status = String(record.status ?? 'degraded')
  const scoreText = score === null ? '无有效评分' : score.toFixed(2)
  const baseText = `${usable.length}/${votes.length} 个 peer`
  lines.push('', `结论：${status} · score ${scoreText} · 基于 ${baseText}${distinct !== null ? ` · ${distinct} 个不同架构` : ''}`)
  if (record.degraded === true && Array.isArray(record.degraded_peers) && record.degraded_peers.length > 0) {
    lines.push(`降级：${record.degraded_peers.join('、')} 未给出有效评分`)
  }
  // Full JSON only on explicit request (B): it is the noisy tail, not the answer.
  if (full) {
    lines.push('', '完整结果：', JSON.stringify(record, null, 2))
  }
  return lines.join('\n')
}

/** Split text into stream-sized deltas so the reply streams, not dumps. */
function chunkText(text, size = 400) {
  const source = String(text ?? '')
  const chunks = []
  for (let index = 0; index < source.length; index += size) chunks.push(source.slice(index, index + size))
  return chunks
}

/** An adapter that serves the `eto` route by running one consensus per turn. */
export class EtoAdapter extends LlmAdapter {
  constructor({ settings, ctx, consensusEnv }) {
    super()
    this.settings = settings
    this.ctx = ctx
    this.consensusEnv = consensusEnv
  }

  providerInfo(provider) {
    return { id: provider, name: 'ETO' }
  }

  listModels(provider) {
    return Promise.resolve([{
      provider,
      id: ETO_MODEL,
      name: 'ETO 三源异构共识',
      description: '三源异构融合评审（本机 Qwen × deepseek-official × qodercn/GLM）。适合主动评审一段方案；不建议当会话主模型（普通问答会走 direct 委托真模型）。',
      inputModalities: ['text'],
    }])
  }

  resolveModel(provider, model) {
    return Promise.resolve({
      provider,
      id: model,
      name: 'ETO 三源异构共识',
      context: { contextWindow: CONTEXT_WINDOW },
      defaultMaxTokens: DEFAULT_MAX_TOKENS,
      inputModalities: ['text'],
    })
  }

  async *stream(options) {
    const signal = options.signal
    const plan = lastUserText(options.messages ?? [])

    if (plan === '') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      const empty = '（本会话没有可评审的文本内容）'
      yield { type: 'text-delta', index: 0, text: empty }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: empty } }
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: estimateTokens(empty), totalTokens: estimateTokens(empty) } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    // Routing gate (A): classify before any fusion. A `direct` turn is an
    // ordinary question — delegate to a real model so the user gets an answer,
    // not a peer review. Only `plan` / `consensus` open the fused review.
    let route
    try {
      route = await runRoute({
        settings: this.settings,
        args: { task: plan },
        signal,
        env: this.consensusEnv(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { code: 'UNKNOWN', message: `ETO route failed: ${message}` },
        },
      }
      return
    }
    if (route?.route === 'direct') {
      yield* this.delegate(options)
      return
    }

    yield { type: 'block-start', index: 0, blockType: 'text' }

    // A live signal before the (slow) consensus: the fused result cannot exist
    // until all three peers answer. This is the honest "long task" marker, not a
    // fabricated per-peer stage.
    yield { type: 'text-delta', index: 0, text: '⏳ ETO 三源异构共识评审中（约 30–90 秒，免费）…\n' }

    let value
    try {
      value = await runConsensus({
        settings: this.settings,
        ctx: this.ctx,
        args: { plan, peers: PEERS },
        signal,
        env: this.consensusEnv(),
      })
    } catch (error) {
      // A failed fusion is reported, never silently replaced with one model.
      const message = error instanceof Error ? error.message : String(error)
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { code: 'UNKNOWN', message: `ETO consensus failed: ${message}` },
        },
      }
      return
    }

    const rendered = renderConsensus(value, { full: wantsFullResult(plan, this.settings()) })
    for (const chunk of chunkText(rendered)) yield { type: 'text-delta', index: 0, text: chunk }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: rendered } }
    yield {
      type: 'usage',
      usage: {
        inputTokens: estimateTokens(plan),
        outputTokens: estimateTokens(rendered),
        totalTokens: estimateTokens(plan) + estimateTokens(rendered),
      },
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  /**
   * Forward a `direct` turn to a real model through the host's LLM service, so
   * the user gets an answer instead of a peer review. The messages are passed
   * through untouched; only the route is chosen from the delegate setting.
   */
  async *delegate(options) {
    const llm = this.ctx?.get?.('llm')
    if (llm === undefined || typeof llm.stream !== 'function') {
      const message = 'ETO routed this turn direct, but no llm service is composed to delegate the answer to'
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UNKNOWN', message } } }
      return
    }
    const route = parseDelegateRoute(this.settings()?.delegateModel)
    yield* llm.stream({
      provider: route.provider,
      model: route.model,
      messages: options.messages,
      signal: options.signal,
    })
  }
}
