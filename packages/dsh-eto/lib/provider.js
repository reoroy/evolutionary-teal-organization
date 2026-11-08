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

/** Used only when the delegate model's real window cannot be resolved. */
const FALLBACK_CONTEXT_WINDOW = 128_000
/**
 * ETO's own input budget, in characters, for the plan text forwarded to the peers.
 * This is ETO's internal concern: a long conversation must not be silently cut by the
 * smallest peer, so ETO caps what it sends and says so in the reply. It is never advertised
 * as the session's context window — that belongs to the model that actually executes.
 */
const PLAN_MAX_CHARS = 24_000
/** Default output budget: a short fusion conclusion plus a little structure. */
const DEFAULT_MAX_TOKENS = 2_048
/** The three peers vote.py fuses by default; keep in sync with the stitch. */
const PEERS = ['researcher', 'coder', 'auditor']

/** Fallback delegate route when the setting is blank: "provider/model". */
const DEFAULT_DELEGATE = { provider: 'deepseek-official', model: 'deepseek-flash' }

/**
 * Clip the plan to ETO's own input budget. Returns the text to forward plus the notice to
 * show, so the clipping is reported rather than silent.
 */
export function capPlan(plan) {
  const text = String(plan ?? '')
  if (text.length <= PLAN_MAX_CHARS) return { forwarded: text, notice: '' }
  return {
    forwarded: text.slice(0, PLAN_MAX_CHARS),
    notice: `⚠️ 输入 ${text.length} 字符超过 ETO 自管预算 ${PLAN_MAX_CHARS}，评审仅覆盖前 ${PLAN_MAX_CHARS} 字符。\n`,
  }
}

/** Split a `provider/model` delegate setting into its two halves. */
export function parseDelegateRoute(value) {
  return parseDelegateChain(value)[0]
}

/**
 * A delegate setting may name a fallback chain: `provider/model,provider/model,...`.
 * The first entry that answers is used, so one exhausted account cannot take the whole
 * consultation layer down — which is exactly what happened when a single delegate model
 * ran out of balance and every `direct` turn started failing while `/status` stayed green.
 */
export function parseDelegateChain(value) {
  const text = String(value ?? '').trim()
  if (text === '') return [{ ...DEFAULT_DELEGATE }]
  const chain = []
  for (const raw of text.split(',')) {
    const entry = raw.trim()
    if (entry === '') continue
    const slash = entry.indexOf('/')
    chain.push(slash === -1
      ? { provider: DEFAULT_DELEGATE.provider, model: entry }
      : { provider: entry.slice(0, slash), model: entry.slice(slash + 1) })
  }
  return chain.length === 0 ? [{ ...DEFAULT_DELEGATE }] : chain
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

  async resolveModel(provider, model) {
    // The session's capacity belongs to the model that actually executes the turn, not to
    // ETO. When a turn is routed `direct` it is delegated to `delegateModel`, so that model's
    // window is the honest answer; DSH's compression and token budgeting then apply to the
    // worker rather than being pinned to the smallest consensus peer.
    const delegate = parseDelegateRoute(this.settings()?.delegateModel)
    let contextWindow = FALLBACK_CONTEXT_WINDOW
    try {
      const llm = this.ctx?.get?.('llm')
      const resolved = await llm?.resolveModel?.(delegate.provider, delegate.model)
      const real = resolved?.context?.contextWindow
      if (typeof real === 'number' && real > 0) contextWindow = real
    } catch { /* keep the fallback: a resolution failure must not block the provider */ }
    return {
      provider,
      id: model,
      name: 'ETO 三源异构共识',
      context: { contextWindow },
      defaultMaxTokens: DEFAULT_MAX_TOKENS,
      inputModalities: ['text'],
    }
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
    // Only an explicit consensus request opens a peer review. `plan` looks like a decision to the
    // router, but a plan still has to be CARRIED OUT — answering it with a review of the plan is what
    // made a "fix this file" turn come back as three opinions and no edit. So `direct` and `plan`
    // both delegate to the real model (which has the tools); the fused review is opt-in.
    if (route?.route !== 'consensus') {
      yield* this.delegate(options)
      return
    }

    yield { type: 'block-start', index: 0, blockType: 'text' }

    // A live signal before the (slow) consensus: the fused result cannot exist
    // until all three peers answer. This is the honest "long task" marker, not a
    // fabricated per-peer stage.
    yield { type: 'text-delta', index: 0, text: '⏳ ETO 三源异构共识评审中（约 30–90 秒，免费）…\n' }

    // ETO owns its own input budget: a long conversation is capped here, with an honest
    // marker, instead of being silently cut by whichever peer is smallest.
    const { forwarded, notice } = capPlan(plan)
    if (notice !== '') yield { type: 'text-delta', index: 0, text: notice }

    let value
    try {
      value = await runConsensus({
        settings: this.settings,
        ctx: this.ctx,
        args: { plan: forwarded, peers: PEERS },
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
    // Forward EVERYTHING the harness asked for, overriding only the route. Dropping fields here
    // is how the delegate ends up without tools: the model then has no tool schema to fill, so it
    // emits its native tool-call markup as plain text and nothing ever executes. `tools` is not
    // optional to pass along — it is the whole reason this path can act at all.
    // A delegated turn belongs to the delegate model, so ETO's own output budget must not
    // travel with it: 2048 tokens is the fused-summary size, and clamping a real answer to it
    // ends the turn with `max-tokens` before the reply is finished.
    const { provider: _provider, model: _model, maxTokens: _maxTokens, ...rest } = options
    const chain = parseDelegateChain(this.settings()?.delegateModel)
    const failures = []
    for (const route of chain) {
      let budget = route.maxTokens
      if (budget === undefined) {
        try {
          const target = await llm.resolveModel?.(route.provider, route.model)
          if (typeof target?.defaultMaxTokens === 'number') budget = target.defaultMaxTokens
        } catch { /* omit the budget and let the target decide */ }
      }
      const ask = () => llm.stream({ ...rest, provider: route.provider, model: route.model, ...(budget === undefined ? {} : { maxTokens: budget }) })
      // Hold chunks until the route produces real content. A provider that is out of balance
      // fails before any text arrives, so nothing has been shown to the caller yet and the chain
      // can move on. Once text has been committed the answer belongs to this route — a later
      // failure is reported instead of silently asking the next model (that would duplicate it).
      const pending = []
      let failed = null
      let committed = false
      try {
        // Iterate ONCE to completion. Breaking out of `for await` closes the iterator, so the
        // "wait until the first real text before committing" rule is expressed as a flag rather
        // than an early break — the same generator keeps producing the rest of the answer.
        for await (const chunk of ask()) {
          if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
            // A failure before any content can still fall through to the next route; one that
            // arrives after content is reported, because the reply is already half-delivered.
            failed = chunk.reason.error ?? { message: 'stream error' }
            break
          }
          if (!committed) {
            pending.push(chunk)
            if (chunk?.type === 'text-delta' && String(chunk.text ?? '').trim() !== '') {
              committed = true
              // The notice is folded into the FIRST text delta rather than emitted as a bare
              // delta: a text-delta that arrives before the block envelope is opened is dropped
              // by the harness, which is why the fallback ran but never showed up in the reply.
              const notice = failures.length > 0
                ? `（${failures.length} 个委托模型不可用，已回落到 ${route.provider}/${route.model}）\n\n`
                : ''
              for (const held of pending) {
                yield (held === chunk && notice !== '') ? { ...held, text: notice + held.text } : held
              }
              pending.length = 0
            }
          } else {
            yield chunk
          }
        }
      } catch (error) {
        failed = { message: error instanceof Error ? error.message : String(error) }
      }
      // Opt-in trace: with ETO_DEBUG_DELEGATE=1 every route in the chain reports what it did.
      // The fallback is invisible otherwise, and "the answer came back" does not prove which
      // model produced it — that ambiguity is what made a silent single-model ETO look healthy.
      if (process.env.ETO_DEBUG_DELEGATE === '1') {
        const line = `[dsh-eto][delegate] ${route.provider}/${route.model} committed=${committed} pending=${pending.length} failed=${JSON.stringify(failed)}`
        console.error(line)
        // stderr from the GUI app does not reach a file, so the trace also lands where the rest of
        // ETO's state lives. Without this the fallback stays invisible in normal operation.
        try {
          const { appendFileSync } = await import('node:fs')
          const { homedir } = await import('node:os')
          const { join } = await import('node:path')
          appendFileSync(join(homedir(), '.eto', 'delegate-trace.log'), `${new Date().toISOString()} ${line}\n`)
        } catch { /* the trace must never break the turn */ }
      }
      if (committed || failed === null) {
        // Committed content (or a clean empty stop) is this route's answer; flush whatever is left.
        for (const held of pending) yield held
        return
      }
      if (failed === null) failed = { message: 'stream produced no content' }
      failures.push(`${route.provider}/${route.model}: ${failed.message}`)
      this.ctx?.logger?.warn?.(`dsh-eto: delegate ${route.provider}/${route.model} failed (${failed.message}); trying next`)
    }
    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { code: 'UNKNOWN', message: `所有委托模型都不可用：${failures.join(' | ')}` },
      },
    }
  }
}
