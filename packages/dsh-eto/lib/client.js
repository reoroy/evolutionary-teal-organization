/**
 * dsh-eto — client half (plain JS, ModuleLoader-wrapped; no build step).
 *
 * Three registrations, all riding this plugin's fiber:
 *   sidebar.panellist / id=eto → the sidebar entry, switching the main column
 *   main / key=eto             → the info panel (status, tools, consensus, routing)
 *   settings.section / id=eto  → the settings panel (paths, whitelist, scoring route)
 *
 * Facts come from the host half's same-origin API:
 *   GET  /@dsh-eto/api/status   → ETO's self-report + this plugin's configuration
 *   POST /@dsh-eto/api/test     → one live probe with latency and per-tool availability
 *
 * Settings writes go through the client's configuration forms (`configForms`),
 * which is the only supported way for a feature to persist its own Host entry.
 * The panel therefore reads the form snapshot rather than the status payload:
 * one source of truth for what is stored, one for what is running.
 */
window.__ModuleLoader__.load({
  id: 'dsh-eto',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement

    const API = '/@dsh-eto/api'
    const HEADERS = { 'x-dsh-eto': '1' }
    const PANEL_ID = 'eto'
    const ENTRY_ID = 'eto'

    const TEXTS = {
      zh: {
        label: 'ETO',
        title: 'ETO 青色组织',
        tabStatus: '状态',
        tabTools: '工具',
        tabSettings: '设置',
        refresh: '刷新',
        test: '测试连接',
        testing: '测试中…',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        saveFailed: '保存失败',
        ok: '连接正常',
        down: 'ETO 不可用',
        unknown: '状态未知',
        version: 'ETO 版本',
        commit: 'commit',
        python: 'Python',
        pathsTitle: 'ETO 位置',
        repo: 'ETO 仓库',
        venv: '虚拟环境',
        interpreter: '解释器',
        toolCount: '工具',
        available: '可用',
        unavailable: '不可用',
        filtered: '已被白名单关闭',
        consensus: '最近共识',
        consensusNone: '还没有共识记录',
        routing: '路由统计',
        routingNone: '还没有路由记录',
        total: '总调用',
        successRate: '成功率',
        routeDist: '路由分布',
        lastCheck: '检查于',
        problems: '需要处理的问题',
        enabledTools: '工具白名单（留空 = 全部）',
        toolTimeout: '工具超时（毫秒）',
        peerScoreRoute: '评分模型',
        peerScoreHint: '留空则用当前会话模型；填 provider 与 model 才能覆盖。',
        provider: 'provider',
        model: 'model',
        peerScoreTimeout: '评分超时（毫秒）',
        delegateModel: '直答委托模型',
        delegateHint: '普通问题路由为 direct 时，用这个 provider/model 直接回答（支持逗号分隔的回落链）。',
        peerConfigTitle: '会诊三源 peer（异构融合）',
        peerConfigHint: '三个 peer 必须是不同架构，否则投票退化为单模型自一致性。provider 选 ollama（直连 HTTP）或 dsh（走宿主 llm 服务，model 填 provider/model）。',
        peerArchWarn: '⚠ 三个 peer 至少两个选不同架构（如一个 GLM、一个 DeepSeek）。全选同一架构 = 单模型自评，融合无意义。',
        peerConfigSaveHint: '保存后写入 ~/.pi/eto-config.json，下次会诊生效。留空 = 用内置默认（researcher/coder 走 Ollama，auditor 走云端）。',
        peerDefaultOption: '— 用内置默认 —',
        peerPickModel: '— 选模型 —',
        includeFullResult: '默认附完整 JSON 结果',
        envPassthrough: '透传环境变量（逗号分隔）',
        pathsHint: '路径支持 ~；留空使用默认值（$DSH_ETO_REPO 或 ~/src/eto）。',
        notWritable: '当前页面无法持久化设置（远程访问时只在本浏览器生效）。',
        unavailable: '设置服务不可用',
        latency: '耗时',
        toolsLive: '工具可用性',
        noEto: 'ETO 未连接，先修好下面的问题再刷新。',
        openSettings: '打开设置',
        guideTitle: '开启 ETO 流程',
        guideStep1: '① 在模型选择器把本会话切到「ETO 编排模式」。',
        guideStep2: '② 然后直接说：「让几个 peer 评审下这个方案」/「这个任务该怎么路由」。',
        guideStep3: '③ 或在任意会话说：「派一个 ETO 编排模式的子 agent 来评审 XXX」（subagent agentPreset=eto）。',
        guideNote: '平时不需要 ETO：工具只在 eto preset 的会话里全量可用，日常对话保持轻量。',
        wbTitle: 'ETO 工作台',
        wbRoute: '任务路由分析',
        wbRoutePh: '输入任务描述，例如：给 README 补一段安装说明',
        wbClarify: '指令澄清器',
        wbClarifyPh: '输入要派活的指令，检查是否模糊',
        wbMemory: '共享记忆',
        wbMemoryKey: 'key（如 consensus:last）',
        wbMemoryValue: 'value（JSON 字符串）',
        wbRun: '执行',
        wbRead: '读取',
        wbWrite: '写入',
        wbList: '列出全部',
        wbRunning: '执行中…',
        wbResult: '结果',
        wbError: '失败',
        wbEmpty: '（无输出）',
        tabWorkbench: '工作台',
        tabMemory: '共享记忆',
        tabStats: '统计',
        statusOk: '正常',
        statusBad: '异常',
        toolsCount: '工具',
        version: '版本',
        commit: 'commit',
        refresh: '刷新',
        statsTitle: '路由统计',
        statsEmpty: '还没有路由记录（先在对话里用 eto_route）',
        consTitle: '最近共识',
        consNone: '还没有共识评审记录',
        memKeysTitle: '全部 key',
        memNoKey: '还没有共享记忆',
        memDeleted: '已写入（覆盖）',
      },
      en: {
        label: 'ETO',
        title: 'ETO Teal Organization',
        tabStatus: 'Status',
        tabTools: 'Tools',
        tabSettings: 'Settings',
        refresh: 'Refresh',
        test: 'Test connection',
        testing: 'Testing…',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        saveFailed: 'Save failed',
        ok: 'Connected',
        down: 'ETO unavailable',
        unknown: 'Unknown',
        version: 'ETO version',
        commit: 'commit',
        python: 'Python',
        pathsTitle: 'ETO location',
        repo: 'ETO checkout',
        venv: 'Virtualenv',
        interpreter: 'Interpreter',
        toolCount: 'Tools',
        available: 'available',
        unavailable: 'unavailable',
        filtered: 'disabled by whitelist',
        consensus: 'Last consensus',
        consensusNone: 'No consensus recorded yet',
        routing: 'Routing stats',
        routingNone: 'No routing records yet',
        total: 'Calls',
        successRate: 'Success rate',
        routeDist: 'Route distribution',
        lastCheck: 'Checked at',
        problems: 'Needs attention',
        enabledTools: 'Tool whitelist (empty = all)',
        toolTimeout: 'Tool timeout (ms)',
        peerScoreRoute: 'Scoring model',
        peerScoreHint: 'Empty uses the session model; both provider and model must be set to override.',
        provider: 'provider',
        model: 'model',
        peerScoreTimeout: 'Scoring timeout (ms)',
        delegateModel: 'Direct-answer delegate',
        delegateHint: 'Direct-routed turns are answered by this provider/model (comma-separated fallback chain supported).',
        peerConfigTitle: 'Consultation peers (heterogeneous fusion)',
        peerConfigHint: 'The three peers must be different architectures, otherwise voting degrades to single-model self-consistency. provider: ollama (direct HTTP) or dsh (via host llm service; model = provider/model).',
        peerArchWarn: '⚠ At least two peers should use different architectures. All-same = single-model self-evaluation, fusion is meaningless.',
        peerConfigSaveHint: 'Saved into ~/.pi/eto-config.json, effective on the next consultation. Empty = built-in defaults.',
        peerDefaultOption: '— built-in default —',
        peerPickModel: '— pick a model —',
        includeFullResult: 'Always append the full JSON result',
        envPassthrough: 'Pass-through env names (comma separated)',
        pathsHint: 'Paths accept ~; empty means the default ($DSH_ETO_REPO or ~/src/eto).',
        notWritable: 'This page cannot persist settings (remote access keeps them in this browser only).',
        unavailable: 'Settings service unavailable',
        latency: 'Latency',
        toolsLive: 'Tool availability',
        noEto: 'ETO is not reachable; fix the problems below and refresh.',
        openSettings: 'Open settings',
        guideTitle: 'Start the ETO flow',
        guideStep1: '① Switch this session to the "ETO" preset in the model picker.',
        guideStep2: '② Then just say: "have peers review this plan" / "route this task".',
        guideStep3: '③ Or in any session: "spawn an ETO subagent to review X" (subagent agentPreset=eto).',
        guideNote: 'ETO is opt-in: tools are only fully available in eto-preset sessions; everyday chats stay light.',
        wbTitle: 'ETO workbench',
        wbRoute: 'Task routing',
        wbRoutePh: 'Describe a task, e.g. add an install note to the README',
        wbClarify: 'Instruction clarifier',
        wbClarifyPh: 'Paste an instruction to check for vagueness',
        wbMemory: 'Shared memory',
        wbMemoryKey: 'key (e.g. consensus:last)',
        wbMemoryValue: 'value (JSON string)',
        wbRun: 'Run',
        wbRead: 'Read',
        wbWrite: 'Write',
        wbList: 'List all',
        wbRunning: 'running…',
        wbResult: 'result',
        wbError: 'failed',
        wbEmpty: '(no output)',
        tabWorkbench: 'Workbench',
        tabMemory: 'Shared memory',
        tabStats: 'Stats',
        statusOk: 'healthy',
        statusBad: 'unhealthy',
        toolsCount: 'tools',
        version: 'version',
        commit: 'commit',
        refresh: 'Refresh',
        statsTitle: 'Routing stats',
        statsEmpty: 'no routing history yet (run eto_route in a conversation first)',
        consTitle: 'Last consensus',
        consNone: 'no consensus review yet',
        memKeysTitle: 'all keys',
        memNoKey: 'shared memory is empty',
        memDeleted: 'written (overwritten)',
      },
    }

    const langOf = (ctx) => {
      try {
        const locale = ctx.get('locale')
        const active = locale && locale.getSnapshot ? locale.getSnapshot().active : ''
        return String(active || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'zh'
      }
    }

    function useLang(ctx) {
      const [lang, setLang] = React.useState(() => langOf(ctx))
      React.useEffect(() => {
        let locale
        try {
          locale = ctx.get('locale')
        } catch {
          locale = undefined
        }
        if (!locale || !locale.subscribe) return undefined
        return locale.subscribe(() => setLang(langOf(ctx)))
      }, [])
      return lang
    }

    const styles = {
      page: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', color: 'var(--dsw-alias-label-primary)' },
      bar: { flex: 'none', display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', borderBottom: '1px solid var(--dsw-alias-border-l1)', flexWrap: 'wrap' },
      title: { fontSize: '14px', fontWeight: 600, margin: 0 },
      pill: { fontSize: '11px', padding: '1px 8px', borderRadius: '999px', border: '1px solid currentColor' },
      spacer: { flex: 1 },
      button: { fontSize: '12px', padding: '4px 10px', borderRadius: '7px', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
      primary: { borderColor: 'var(--dsw-alias-brand-primary)', background: 'transparent', color: 'var(--dsw-alias-brand-primary)', fontWeight: 600 },
      disabled: { opacity: 0.45, cursor: 'default' },
      body: { flex: 1, minHeight: 0, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' },
      card: { background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '12px', padding: '14px' },
      cardTitle: { fontSize: '12px', fontWeight: 600, marginBottom: '10px', color: 'var(--dsw-alias-label-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' },
      row: { display: 'flex', gap: '12px', alignItems: 'baseline', padding: '4px 0', fontSize: '13px' },
      key: { width: '132px', flex: 'none', color: 'var(--dsw-alias-label-secondary)' },
      value: { wordBreak: 'break-all', fontFamily: 'var(--dsw-font-mono, ui-monospace, monospace)' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 16px', fontSize: '12px' },
      tool: { display: 'flex', alignItems: 'center', gap: '7px' },
      dot: { width: '7px', height: '7px', borderRadius: '50%', flex: 'none' },
      muted: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      error: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'pre-wrap' },
      warn: { fontSize: '12px', color: 'var(--dsw-alias-state-warn-primary)', whiteSpace: 'pre-wrap' },
      ok: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' },
      field: { display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '12px' },
      label: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      input: { fontSize: '13px', padding: '5px 8px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit' },
      check: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' },
      checkGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 14px' },
    }

    function Icon(props) {
      const size = (props && props.size) || 18
      const active = props && props.active
      // Three interlocking nodes: the teal-organization shape (peers, not a hierarchy).
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color,
        strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block', flex: 'none' },
      },
      h('circle', { cx: 12, cy: 6.2, r: 2.6 }),
      h('circle', { cx: 6.4, cy: 16.4, r: 2.6 }),
      h('circle', { cx: 17.6, cy: 16.4, r: 2.6 }),
      h('path', { d: 'M10.4 8.4 7.9 13.9M13.6 8.4l2.5 5.5M9 16.4h6' }))
    }

    const Pill = ({ text, color }) => h('span', { style: { ...styles.pill, color } }, text)

    const Button = ({ children, onClick, disabled, primary }) => {
      const base = primary ? { ...styles.button, ...styles.primary } : styles.button
      return h('button', { type: 'button', onClick, disabled, style: disabled ? { ...base, ...styles.disabled } : base }, children)
    }

    const Field = ({ label, children }) => h('div', { style: styles.field }, h('span', { style: styles.label }, label), children)

    const Input = ({ value, onChange, placeholder, type }) => h('input', {
      type: type || 'text', value: value ?? '', placeholder, style: styles.input,
      onChange: (event) => onChange(event.target.value),
    })

    const Row = ({ k, v }) => h('div', { style: styles.row },
      h('span', { style: styles.key }, k),
      h('span', { style: styles.value }, v === null || v === undefined || v === '' ? '—' : String(v)))

    const statusOf = async ({ fresh = false } = {}) => {
      const response = await fetch(API + '/status' + (fresh ? '?fresh=1' : ''), { headers: HEADERS, cache: 'no-store' })
      const value = await response.json().catch(() => null)
      if (!response.ok) throw new Error((value && value.error) || 'HTTP ' + response.status)
      return value
    }

    const testConnection = async () => {
      const response = await fetch(API + '/test', { method: 'POST', headers: { ...HEADERS, 'content-type': 'application/json' }, body: '{}' })
      const value = await response.json().catch(() => null)
      if (!response.ok) throw new Error((value && value.error) || 'HTTP ' + response.status)
      return value
    }

    /** One status payload shared by both panels; refetched on demand and on a timer. */
    function useStatus() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const load = React.useCallback(async (fresh) => {
        setBusy(true)
        try {
          setData(await statusOf({ fresh }))
          setError(null)
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setBusy(false)
        }
      }, [])
      React.useEffect(() => {
        load(false)
        const timer = setInterval(() => load(false), 30_000)
        return () => clearInterval(timer)
      }, [load])
      return { data, error, busy, reload: load }
    }

    /** The configuration form for this plugin's Host entry, if the page can reach it. */
    function useConfigForm(ctx) {
      const [state, setState] = React.useState({ form: null, snapshot: null, error: null })
      React.useEffect(() => {
        let disposed = false
        let unsubscribe = null
        let stopWatch = null
        const attach = () => {
          let forms
          try {
            forms = ctx.get('configForms')
          } catch {
            forms = undefined
          }
          if (!forms || typeof forms.get !== 'function') {
            if (!disposed) setState({ form: null, snapshot: null, error: 'unavailable' })
            return
          }
          const served = (() => {
            try {
              const view = forms.describe?.().getSnapshot?.().view
              return Array.isArray(view?.namespaces) ? view.namespaces.map(entry => String(entry.ns ?? '')) : []
            } catch {
              return []
            }
          })()
          const entryId = served.find(ns => ns === ENTRY_ID) ?? served.find(ns => ns.endsWith('/' + ENTRY_ID)) ?? ENTRY_ID
          let form
          try {
            form = forms.get(entryId)
          } catch (reason) {
            if (!disposed) setState({ form: null, snapshot: null, error: reason instanceof Error ? reason.message : String(reason) })
            return
          }
          const publish = () => {
            if (!disposed) setState({ form, snapshot: form.getSnapshot(), error: null })
          }
          publish()
          try {
            unsubscribe = form.subscribe(publish)
          } catch {
            unsubscribe = null
          }
        }
        attach()
        try {
          const forms = ctx.get('configForms')
          const mirror = forms?.describe?.()
          if (mirror && mirror.subscribe) stopWatch = mirror.subscribe(() => attach())
        } catch {
          stopWatch = null
        }
        return () => {
          disposed = true
          try {
            unsubscribe?.()
          } catch {
            // already released
          }
          try {
            stopWatch?.()
          } catch {
            // already released
          }
        }
      }, [])
      return state
    }
    class PanelBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error, info) { console.error('[dsh-eto] panel render failed:', error, info) }
      render() {
        if (this.state.error) {
          return h('div', { style: { padding: '24px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--dsw-alias-label-critical, #e74c3c)', whiteSpace: 'pre-wrap' } },
            'Inline panel error:\n', String(this.state.error && this.state.error.stack || this.state.error))
        }
        return this.props.children
      }
    }

    /** Status → tag label + colour, shared by the list rows and the detail header. */
    const REVIEW_STATUS = {
      approved: { zh: '通过', en: 'Approved', color: 'var(--dsw-alias-label-positive, #2ecc71)' },
      revise: { zh: '需修改', en: 'Revise', color: 'var(--dsw-alias-label-warn, #d29922)' },
      degraded: { zh: '降级', en: 'Degraded', color: 'var(--dsw-alias-label-critical, #e74c3c)' },
      partial: { zh: '只留路由', en: 'Partial', color: 'var(--dsw-alias-label-warn, #d29922)' },
      // `advise` records carry no verdict at all: the consultation returned advice, not a score.
      advise: { zh: '会诊', en: 'Advise', color: 'var(--dsw-alias-brand-primary)' },
    }

    /**
     * A record is either a scorecard (`status` + `final_score`, the retired shape) or a consultation
     * (`synthesis` + `advice/risks/disagreements`). Both live in the same ledger, so every reader has to
     * accept both: old files stay readable, and new ones never pretend a consultation produced a score.
     */
    const isAdvise = record => record !== null && record !== undefined
      && (record.status === undefined || record.status === null || record.status === 'advise' || typeof record.synthesis === 'string')

    /** The consultation body, whichever field the record happens to use. */
    const adviseBody = record => {
      const head = typeof record?.synthesis === 'string' ? record.synthesis.trim() : ''
      const parts = [head]
      for (const key of ['advice', 'risks', 'disagreements']) {
        const value = record?.[key]
        if (typeof value === 'string' && value.trim() !== '') parts.push(value.trim())
        else if (Array.isArray(value) && value.length > 0) parts.push(value.map(v => '- ' + String(v)).join('\n'))
      }
      return parts.filter(part => part !== '').join('\n\n')
    }

    /** A short architecture family for a provider/model pair (for `fusion.sources`). */
    const archLabel = (provider, model) => {
      const m = String(model || '').toLowerCase()
      const p = String(provider || '').toLowerCase()
      if (m.includes('qwen')) return 'Qwen'
      if (m.includes('glm')) return 'GLM'
      if (m.includes('deepseek')) return 'DeepSeek'
      if (m.includes('gpt')) return 'GPT'
      if (m.includes('claude')) return 'Claude'
      if (p.includes('ollama')) return 'Ollama'
      if (p.includes('dsh')) return 'DSH'
      return ''
    }

    /** The per-peer provider/model list: `fusion.sources` when present, else votes. */
    const sourcesOf = record => {
      if (record && record.fusion && Array.isArray(record.fusion.sources) && record.fusion.sources.length > 0) {
        return record.fusion.sources
      }
      return (record && record.votes ? record.votes : []).map(v => ({ peer: v.peer, provider: v.provider, model: v.model }))
    }

    /** Distinct architecture families this review actually used, in peer order. */
    const distinctArches = record => {
      const labels = []
      for (const source of sourcesOf(record)) {
        const label = archLabel(source.provider, source.model)
        if (label !== '' && !labels.includes(label)) labels.push(label)
      }
      return labels
    }

    const fmtDuration = ms => (typeof ms === 'number' && Number.isFinite(ms) ? (ms / 1000).toFixed(1) + 's' : '—')

    const fmtTime = at => {
      const when = new Date(at)
      if (Number.isNaN(when.getTime())) return '—'
      const pad = n => String(n).padStart(2, '0')
      return `${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`
    }

    function InfoPage(props) {
      const ctx = props.__ctx
      const lang = useLang(ctx)
      const { data, busy, reload } = useStatus()
      const [reviews, setReviews] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [selected, setSelected] = React.useState(null)
      const [copied, setCopied] = React.useState(0)
      const eto = (data && data.eto) || {}
      const ok = Boolean(data && data.ok)
      const labelOf = key => (REVIEW_STATUS[key] || { zh: key, en: key })[lang === 'zh' ? 'zh' : 'en']

      const load = React.useCallback(async () => {
        try {
          const res = await fetch(API + '/reviews', { headers: HEADERS, cache: 'no-store' })
          const value = await res.json().catch(() => null)
          if (!res.ok) throw new Error((value && value.error) || 'HTTP ' + res.status)
          const list = Array.isArray(value.reviews) ? value.reviews : []
          setReviews(list)
          setError(null)
          setSelected(prev => (prev !== null && list.some(r => r.id === prev)) ? prev : ((list[0] && list[0].id) || null))
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }, [])

      React.useEffect(() => {
        load()
        const timer = setInterval(load, 30_000)
        return () => clearInterval(timer)
      }, [load])

      const current = (reviews || []).find(r => r.id === selected) || null

      const copyJson = async () => {
        if (!current) return
        try {
          await navigator.clipboard.writeText(JSON.stringify(current, null, 2))
          setCopied(current.id)
          setTimeout(() => setCopied(0), 1500)
        } catch (e) {
          setError('复制失败（浏览器拒绝）：' + (e && e.message ? e.message : String(e)))
        }
      }

      const pill = { fontSize: '11px', padding: '3px 9px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)' }
      const tag = (color) => ({ fontSize: '11px', padding: '1px 8px', borderRadius: '999px', border: '1px solid ' + color, color })

      const stOf = r => REVIEW_STATUS[r.status] || REVIEW_STATUS.approved
      const titleOf = r => (r.plan ? String(r.plan).split('\n')[0].trim() : '') || '(无标题)'
      const scoreColor = score => (score >= 0.7 ? 'var(--dsw-alias-label-positive, #2ecc71)' : score >= 0.5 ? 'var(--dsw-alias-label-warn, #d29922)' : 'var(--dsw-alias-label-critical, #e74c3c)')

      const renderRow = r => {
        const advise = isAdvise(r)
        const st = advise ? REVIEW_STATUS.advise : stOf(r)
        const arches = distinctArches(r)
        const votes = Array.isArray(r.votes) ? r.votes : []
        const okCount = votes.filter(v => v.score !== null && v.score !== undefined).length
        const failedCount = votes.length - okCount
        // A consultation has no per-peer score, so "N peers dropped out" is meaningless there.
        const degraded = !advise && (r.degraded === true || failedCount > 0)
        const archText = arches.length > 0
          ? `${arches.length} 架构（${arches.join('·')}）`
          : `${votes.length} peers`
        return h('div', {
          key: r.id, onClick: () => setSelected(r.id),
          style: {
            padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--dsw-alias-border-l1)',
            background: r.id === selected ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
            borderLeft: r.id === selected ? '2px solid var(--dsw-alias-brand-primary)' : '2px solid transparent',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '7px' } },
            h('span', { style: tag(st.color) }, advise ? labelOf('advise') : labelOf(r.status)),
            h('span', { style: { ...styles.muted, fontSize: '11px' } }, fmtTime(r.at)),
            h('span', { style: { ...styles.muted, fontSize: '11px', marginLeft: 'auto' } }, fmtDuration(r.elapsedMs))),
          h('div', { style: { fontSize: '12px', fontWeight: 600, marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, titleOf(r)),
          h('div', { style: { ...styles.muted, fontSize: '11px', marginTop: '3px' } },
            h('span', null, archText),
            degraded ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)', marginLeft: '7px' } }, `${failedCount} peer 掉队`) : null))
      }

      const peerCard = v => {
        const failed = v.score === null || v.score === undefined
        const providerModel = [v.provider, v.model].filter(Boolean).join('/')
        return h('div', { key: v.peer, style: { ...styles.card, padding: '12px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' } },
            h('span', { style: { fontWeight: 600, fontSize: '12.5px' } }, v.peer),
            providerModel ? h('span', { style: { ...styles.muted, fontSize: '11px' } }, providerModel) : null,
            h('span', { style: { marginLeft: 'auto', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--dsw-font-mono, monospace)', color: failed ? 'var(--dsw-alias-state-error-primary)' : scoreColor(Number(v.score)) } },
              failed ? '无有效分' : Number(v.score).toFixed(2))),
          v.concern ? h('div', { style: { ...(failed ? styles.error : styles.muted), fontSize: '12px', marginTop: '6px', whiteSpace: 'pre-wrap' } },
            (failed ? '掉队原因：' : '疑虑：') + v.concern) : null,
          v.suggestion ? h('div', { style: { ...styles.muted, fontSize: '12px', marginTop: '4px', whiteSpace: 'pre-wrap' } }, '建议：' + v.suggestion) : null)
      }

      const renderDetail = () => {
        if (!current) return h('div', { style: styles.muted }, '左侧选一条记录')
        const advise = isAdvise(current)
        const st = advise ? REVIEW_STATUS.advise : stOf(current)
        const arches = distinctArches(current)
        const votes = Array.isArray(current.votes) ? current.votes : []
        const okCount = votes.filter(v => v.score !== null && v.score !== undefined).length
        const failedCount = votes.length - okCount
        const verdict = advise
          ? adviseBody(current) || '这条会诊记录没有正文。'
          : votes.length === 0
          ? '这条记录没有 peer 评分。'
          : failedCount === 0
            ? `结论基于 ${okCount}/${votes.length} 个 peer。`
            : `结论只基于 ${okCount}/${votes.length} 个 peer —— 另外 ${failedCount} 个没给出有效评分，原因写在下面。`
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
          h('div', null,
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' } },
              h('span', { style: tag(st.color) }, advise ? labelOf('advise') : labelOf(current.status)),
              h('span', { style: { fontSize: '13px', fontWeight: 600 } }, titleOf(current)),
              // No score line for a consultation: fabricating one is exactly what the retired scorecard did.
              advise ? null : h('span', { style: { fontSize: '12px', fontFamily: 'var(--dsw-font-mono, monospace)', color: st.color } },
                current.final_score === null || current.final_score === undefined ? '—' : Number(current.final_score).toFixed(2))),
            h('div', { style: { ...styles.muted, fontSize: '11px', marginTop: '6px', display: 'flex', gap: '12px', flexWrap: 'wrap' } },
              h('span', null, '时间 ' + fmtTime(current.at)),
              h('span', null, '耗时 ' + fmtDuration(current.elapsedMs)),
              h('span', null, '架构 ' + (arches.length ? arches.join('·') : '—')))),
          h('div', { style: styles.card },
            h('div', { style: styles.cardTitle }, '结论'),
            h('div', { style: { fontSize: '13px' } }, verdict),
            Array.isArray(current.actions) && current.actions.length
              ? h('ul', { style: { margin: '8px 0 0', paddingLeft: '18px', fontSize: '12.5px', color: 'var(--dsw-alias-label-secondary)' } },
                current.actions.map(a => h('li', { key: a }, a)))
              : null),
          current.synthesis
            ? h('div', { style: styles.card },
              h('div', { style: styles.cardTitle }, '融合结论'),
              h('div', { style: { fontSize: '12.5px', whiteSpace: 'pre-wrap', color: 'var(--dsw-alias-label-primary)' } }, current.synthesis))
            : null,
          votes.length
            ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' } },
              votes.map(peerCard))
            : null,
          h('div', { style: styles.card },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              h('div', { style: { ...styles.cardTitle, marginBottom: 0 } }, '被评的东西'),
              h('span', { style: { flex: 1 } }),
              h('button', { style: styles.button, onClick: copyJson }, copied === current.id ? '已复制 ✓' : '复制 JSON')),
            h('div', { style: { marginTop: '10px' } },
              current.plan
                ? h('pre', { style: { whiteSpace: 'pre-wrap', margin: 0, fontSize: '12px', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '10px' } }, current.plan)
                : h('div', { style: styles.muted }, '输入没有留存。'))))
      }

      return h('div', { style: { ...styles.page, padding: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
          h('h2', { style: { ...styles.title, margin: 0 } }, 'ETO'),
          h('span', { style: { ...pill, color: ok ? 'var(--dsw-alias-label-positive, #2ecc71)' : 'var(--dsw-alias-label-critical, #e74c3c)' } }, ok ? '✓' : '✗'),
          h('span', { style: pill }, (eto.version || '?') + ' · ' + String(eto.commit || '?').slice(0, 7)),
          h('span', { style: { flex: 1 } }),
          h('button', { style: styles.button, onClick: () => reload({ fresh: true }), disabled: busy }, busy ? '…' : '↻')),
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } },
          h('div', { style: { width: '300px', flex: '0 0 300px', borderRight: '1px solid var(--dsw-alias-border-l1)', overflowY: 'auto', display: 'flex', flexDirection: 'column' } },
            h('div', { style: { padding: '10px 14px', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
              h('div', { style: styles.cardTitle }, '评审台账'),
              error ? h('div', { style: { ...styles.error, marginTop: '6px' } }, error) : null),
            reviews === null
              ? h('div', { style: { ...styles.muted, padding: '16px' } }, '…')
              : reviews.length === 0
                ? h('div', { style: { ...styles.muted, padding: '16px' } }, '还没有评审记录。在对话里让 eto_consensus 评审一次方案后，记录会出现在这里。')
                : reviews.map(renderRow)),
          h('div', { style: { flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px' } },
            renderDetail())))
    }

    function SettingsPage(props) {
      const ctx = props.__ctx
      const t = TEXTS[useLang(ctx)]
      const { form, snapshot, error } = useConfigForm(ctx)
      const status = useStatus()
      const [draft, setDraft] = React.useState(null)
      const [state, setState] = React.useState('idle')
      const [message, setMessage] = React.useState(null)
      const [test, setTest] = React.useState(null)
      const [catalog, setCatalog] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const res = await fetch(API + '/catalog', { headers: HEADERS, cache: 'no-store' })
            const body = res.ok ? await res.json() : null
            if (alive) setCatalog((body && body.providers) || [])
          } catch { if (alive) setCatalog([]) }
        })()
        return () => { alive = false }
      }, [])

      /** Models the editor may offer for one provider (ollama's list is discovered, not static). */
      const candidateModels = (providerId, group, all) => {
        if (providerId === '') return []
        if (group) return (group.models || []).map(m => m.id)
        return []
      }

      /** One peer from the structured settings array, or {} when the role is unset. */
      const peerOf = (peers, role) => {
        if (!Array.isArray(peers)) return {}
        const hit = peers.find(e => e && e.role === role)
        return hit && typeof hit === 'object' ? hit : {}
      }

      /** Store one role back into the structured array, keeping the canonical role order. */
      const writePeer = (role, next, draftNow, setField) => {
        const current = Array.isArray(draftNow.peers) ? draftNow.peers : []
        const rest = current.filter(e => e && e.role !== role)
        const entry = { role, provider: '', model: '', host: '', ...next }
        // Keep a half-filled row (provider picked, model not yet). Dropping it here is what made
        // the selection visibly revert to "built-in default" the moment a provider was chosen.
        const merged = entry.provider === '' ? rest : [...rest, entry]
        const order = ['researcher', 'coder', 'auditor']
        merged.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
        setField('peers')(merged)
      }

      const [testing, setTesting] = React.useState(false)

      const value = snapshot && snapshot.value ? snapshot.value : null
      // The host may not echo a newly added volatile field back right away. If we blindly replace
      // the draft on every snapshot change, an unsaved (or just-saved) peer choice vanishes and
      // the editor falls back to "default" — exactly the reported symptom. Keep the operator's
      // edits by merging on top of the server value, and never clobber a non-empty peer JSON with
      // a missing/empty one.
      React.useEffect(() => {
        if (value === null) return
        setDraft((current) => {
          const merged = { ...value, ...(current || {}) }
          if (current && Array.isArray(current.peers) && current.peers.length > 0
              && (!Array.isArray(value.peers) || value.peers.length === 0)) {
            merged.peers = current.peers
          }
          return merged
        })
      }, [value && JSON.stringify(value)])

      const set = (key) => (next) => setDraft((current) => ({ ...(current || {}), [key]: next }))

      const save = async () => {
        if (!form || !draft) return
        setState('saving')
        setMessage(null)
        try {
          const ops = []
          const scalar = ['repo', 'venv', 'python', 'peerScoreProvider', 'peerScoreModel', 'toolTimeoutMs', 'peerScoreTimeoutMs', 'delegateModel', 'ollamaRemote']
          for (const key of scalar) {
            const next = draft[key]
            const before = value ? value[key] : undefined
            if (String(next ?? '') === String(before ?? '')) continue
            ops.push({ op: 'set', path: [key], value: typeof next === 'number' ? next : String(next ?? '') })
          }
          for (const key of ['enabledTools', 'envPassthrough']) {
            const next = draft[key] ?? []
            const before = (value && value[key]) ?? []
            if (JSON.stringify(next) === JSON.stringify(before)) continue
            ops.push({ op: 'set', path: [key], value: next })
          }
          for (const key of ['includeFullResult']) {
            const next = Boolean(draft[key])
            const before = Boolean(value && value[key])
            if (next !== before) ops.push({ op: 'set', path: [key], value: next })
          }
          // The peers are a structured settings field, so they travel with the form itself —
          // the same shape dsh-moa uses for its presets. Nothing is mirrored to a side file:
          // one owner, so the panel and the runtime cannot disagree.
          if (JSON.stringify(draft.peers || []) !== JSON.stringify((value && value.peers) || [])) {
            ops.push({ op: 'set', path: ['peers'], value: draft.peers || [] })
          }

          if (ops.length !== 0) {
            const accepted = await form.mutate(ops)
            if (!accepted) { setState('failed'); setMessage(t.saveFailed); return }
          }
          setState('saved')
          setMessage(null)
        } catch (reason) {
          setState('failed')
          setMessage(reason instanceof Error ? reason.message : String(reason))
        }
      }

      const runTest = async () => {
        setTesting(true)
        setTest(null)
        try {
          setTest(await testConnection())
        } catch (reason) {
          setTest({ ok: false, error: reason instanceof Error ? reason.message : String(reason) })
        } finally {
          setTesting(false)
        }
      }

      if (error === 'unavailable') {
        return h('div', { style: styles.page }, h('div', { style: styles.body }, h('div', { style: styles.card }, h('div', { style: styles.muted }, t.unavailable))))
      }
      if (error !== null && error !== undefined) {
        return h('div', { style: styles.page }, h('div', { style: styles.body }, h('div', { style: styles.card }, h('div', { style: styles.error }, String(error)))))
      }
      if (draft === null) {
        return h('div', { style: styles.page }, h('div', { style: styles.body }, h('div', { style: styles.card }, h('div', { style: styles.muted }, '…'))))
      }

      // The catalog comes from the host (it owns the list); the test result only
      // adds ETO's live view of it. Never leave the whitelist empty just because
      // nobody pressed "test" yet.
      const toolNames = (status.data && status.data.tools) || (test && test.tools) || []
      const enabled = Array.isArray(draft.enabledTools) ? draft.enabledTools : []
      const toggleTool = (name) => {
        const next = enabled.includes(name) ? enabled.filter(item => item !== name) : [...enabled, name]
        set('enabledTools')(next)
      }

      return h('div', { style: styles.page },
        h('div', { style: styles.body },
          snapshot && !snapshot.writable ? h('div', { style: styles.card }, h('div', { style: styles.warn }, t.notWritable)) : null,
          h('div', { style: styles.card },
            h('div', { style: styles.cardTitle }, t.pathsTitle),
            h(Field, { label: t.repo }, h(Input, { value: draft.repo, onChange: set('repo'), placeholder: '~/src/eto' })),
            h(Field, { label: t.venv }, h(Input, { value: draft.venv, onChange: set('venv'), placeholder: '~/src/eto/.venv' })),
            h(Field, { label: t.interpreter }, h(Input, { value: draft.python, onChange: set('python'), placeholder: '~/src/eto/.venv/bin/python' })),
            h('div', { style: styles.muted }, t.pathsHint),
            h(Field, { label: t.toolTimeout }, h(Input, { type: 'number', value: draft.toolTimeoutMs, onChange: (next) => set('toolTimeoutMs')(Number(next) || 0) }))),
          h('div', { style: styles.card },
            h('div', { style: styles.cardTitle }, t.enabledTools),
            h('div', { style: styles.checkGrid },
              (toolNames.length > 0 ? toolNames : []).map(name => h('label', { key: name, style: styles.check },
                h('input', { type: 'checkbox', checked: enabled.includes(name), onChange: () => toggleTool(name) }),
                h('span', { style: { fontFamily: 'var(--dsw-font-mono, ui-monospace, monospace)' } }, name)))),
            toolNames.length === 0 ? h('div', { style: styles.muted }, '…') : null,
            h('div', { style: { marginTop: '10px' } },
              h(Button, { disabled: testing, onClick: runTest }, testing ? t.testing : t.test),
              test
                ? h('span', { style: { ...(test.ok ? styles.ok : styles.error), marginLeft: '10px' } },
                  test.ok ? `${t.ok} · ${t.latency} ${test.latencyMs} ms` : `${t.down} · ${test.error || ''}`)
                : null)),
          h('div', { style: styles.card },
            h('div', { style: styles.cardTitle }, t.peerScoreRoute),
            h(Field, { label: t.provider }, h(Input, { value: draft.peerScoreProvider, onChange: set('peerScoreProvider'), placeholder: 'deepseek' })),
            h(Field, { label: t.model }, h(Input, { value: draft.peerScoreModel, onChange: set('peerScoreModel'), placeholder: 'deepseek-v4.1-flash' })),
            h('div', { style: styles.muted }, t.peerScoreHint),
            h(Field, { label: t.peerScoreTimeout }, h(Input, { type: 'number', value: draft.peerScoreTimeoutMs, onChange: (next) => set('peerScoreTimeoutMs')(Number(next) || 0) })),
            h(Field, { label: t.envPassthrough }, h(Input, {
              value: (draft.envPassthrough || []).join(', '),
              onChange: (next) => set('envPassthrough')(next.split(',').map(item => item.trim()).filter(Boolean)),
            }))),
          h('div', { style: styles.card },
            h('div', { style: styles.cardTitle }, t.delegateModel),
            h(Field, { label: t.delegateModel }, h(Input, { value: draft.delegateModel, onChange: set('delegateModel'), placeholder: 'deepseek-official/deepseek-flash' })),
            h('div', { style: { ...styles.muted } }, t.delegateHint),
            h('div', { style: { height: '14px' } }),
            h(Field, { label: 'Ollama 远端地址' }, h(Input, {
              value: draft.ollamaRemote || '',
              onChange: set('ollamaRemote'),
              placeholder: 'http://192.168.10.4:11434（留空 = 只用本机）',
            })),
            h('div', { style: { ...styles.cardTitle, marginTop: '6px' } }, t.peerConfigTitle),
            h('div', { style: { ...styles.muted, marginBottom: '8px' } }, t.peerConfigHint),
            ['researcher', 'coder', 'auditor'].map((role) => {
              const stored = peerOf(draft.peers, role)
              // Derive the editor value from what is ACTUALLY stored, never from a cached render.
              // The stored shape is vote.py's: {provider:'dsh', model:'provider/model'} or
              // {provider:'ollama', model:'tag', host?}. The editor shows provider + model separately.
              const isDsh = stored.provider === 'dsh'
              const fullModel = typeof stored.model === 'string' ? stored.model : ''
              const slash = fullModel.indexOf('/')
              const dshProvider = isDsh && slash > 0 ? fullModel.slice(0, slash) : ''
              const dshModel = isDsh && slash > 0 ? fullModel.slice(slash + 1) : (isDsh ? fullModel : '')
              const isOllama = stored.provider === 'ollama'
              const ollamaKey = isOllama ? `ollama|${stored.host || ''}` : ''
              const providerKey = isDsh ? dshProvider : ollamaKey
              const shownModel = isDsh ? dshModel : (isOllama ? fullModel : '')
              const group = (catalog || []).find(g => g.id === providerKey || (isDsh && g.id === dshProvider) || (isOllama && g.isOllama && (g.host || '') === (stored.host || '')))
              const models = (() => {
                const found = (catalog || []).filter(g =>
                  (isDsh && g.id === dshProvider) || (isOllama && g.isOllama && (g.host || '') === (stored.host || '')))
                const ids = []
                for (const g of found) for (const m of (g.models || [])) if (!ids.includes(m.id)) ids.push(m.id)
                return ids
              })()

              // Selecting a provider keeps the model the operator already had for that provider,
              // so switching provider does not blank the row and drop it from the saved array.
              const onProvider = (raw) => {
                if (raw === '') { writePeer(role, { provider: '', model: '' }, draft, set); return }
                if (raw.startsWith('ollama|')) {
                  const host = raw.slice('ollama|'.length)
                  const keep = isOllama ? fullModel : ''
                  const grp = (catalog || []).find(g => g.isOllama && (g.host || '') === host)
                  const fallback = (grp && grp.models && grp.models[0] && grp.models[0].id) || ''
                  writePeer(role, { provider: 'ollama', model: keep || fallback, host }, draft, set)
                } else {
                  // Auto-pick the provider's first model so choosing a provider never leaves the
                  // row blank — that blank state was the whole "reverts to default" symptom.
                  const keep = isDsh && dshProvider === raw ? dshModel : ''
                  const grp = (catalog || []).find(g => g.id === raw)
                  const fallback = (grp && grp.models && grp.models[0] && grp.models[0].id) || ''
                  writePeer(role, { provider: 'dsh', model: `${raw}/${keep || fallback}`, host: '' }, draft, set)
                }
              }
              const onModel = (modelId) => {
                if (isOllama) writePeer(role, { provider: 'ollama', model: modelId, host: stored.host || '' }, draft, set)
                else writePeer(role, { provider: 'dsh', model: modelId ? `${dshProvider || providerKey}/${modelId}` : '', host: '' }, draft, set)
              }
              return h('div', { key: role, style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' } },
                h('span', { style: { ...styles.muted, width: '80px', fontSize: '12px', fontWeight: 600 } }, role),
                h('select', {
                  value: providerKey,
                  onChange: (ev) => onProvider(String(ev.target.value || '')),
                  style: { ...styles.input, width: '170px' },
                },
                  h('option', { value: '' }, t.peerDefaultOption),
                  (catalog || []).map((g, gi) => h('option', {
                    key: `${g.id}-${gi}`,
                    value: g.isOllama ? `ollama|${g.host || ''}` : g.id,
                  }, g.name || g.id))),
                h('select', {
                  value: shownModel,
                  onChange: (ev) => onModel(String(ev.target.value || '')),
                  style: { ...styles.input, flex: '1', minWidth: '190px' },
                },
                  h('option', { value: '' }, t.peerPickModel),
                  models.filter(id => id !== '').map(id => h('option', { key: id, value: id }, id)),
                  shownModel !== '' && !models.includes(shownModel)
                    ? h('option', { value: shownModel }, shownModel + '  (当前值)')
                    : null))
            }),
            h('div', { style: { ...styles.warn, fontSize: '11px' } }, t.peerArchWarn),
            h('div', { style: { ...styles.muted, fontSize: '11px' } }, t.peerConfigSaveHint),
            h('div', { style: styles.checkGrid },
              h('label', { style: styles.check },
                h('input', { type: 'checkbox', checked: Boolean(draft.includeFullResult), onChange: () => set('includeFullResult')(!draft.includeFullResult) }),
                h('span', null, t.includeFullResult)))),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
            h(Button, { primary: true, disabled: state === 'saving', onClick: save }, state === 'saving' ? t.saving : t.save),
            state === 'saved' ? h('span', { style: styles.ok }, t.saved) : null,
            message ? h('span', { style: styles.error }, message) : null)))
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => TEXTS[langOf(ctx)].label,
      }, Icon)), 'dsh-eto: sidebar entry')

      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main', key: PANEL_ID,
      }, (props) => h(PanelBoundary, null, h(InfoPage, { ...props, __ctx: ctx }))), 'dsh-eto: info panel'))

      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: PANEL_ID, order: 45, label: () => TEXTS[langOf(ctx)].title,
      }, (props) => h(SettingsPage, { ...props, __ctx: ctx }))), 'dsh-eto: settings panel')
    }

    module.exports = { inject, apply }
    return module.exports
  },
})
