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

    const HISTORY_KEY = 'dsh-eto:history'
    const HISTORY_MAX = 50

    function readHistory() {
      try {
        const raw = window.localStorage.getItem(HISTORY_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed) ? parsed : []
      } catch { return [] }
    }
    function writeHistory(list) {
      try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))) } catch { /* quota / private mode */ }
    }

    const ACTION_LABEL = {
      route: { zh: '路由', en: 'Route' },
      clarify: { zh: '澄清', en: 'Clarify' },
      consensus: { zh: '评审', en: 'Review' },
      flow: { zh: '完整流程', en: 'Full flow' },
    }

    /** Seed a new conversation with a workbench result. Requires the client `agents` service. */
    async function importToConversation(ctx, text) {
      const agents = ctx.get('agents')
      if (!agents || typeof agents.createSession !== 'function') {
        throw new Error('当前客户端没有 agents.createSession，无法导入对话')
      }
      const created = await agents.createSession({ initialMessage: text })
      if (created && typeof agents.enter === 'function') agents.enter(created)
      return created
    }

    function TimelineEntry({ entry, label, onRerun, onImport, importing }) {
      const [open, setOpen] = React.useState(false)
      const color = entry.ok ? 'var(--dsw-alias-label-positive, #2ecc71)' : 'var(--dsw-alias-label-critical, #e74c3c)'
      const when = new Date(entry.at)
      const hhmm = String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0')
      return h('div', { style: { borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 2px', cursor: 'pointer' },
          onClick: () => setOpen(!open) },
          h('span', { style: { color, fontWeight: 700, width: '14px' } }, entry.ok ? '✓' : '✗'),
          h('span', { style: { fontSize: '12px', fontWeight: 600, minWidth: '64px' } }, label),
          h('span', { style: { ...styles.muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            String(entry.input || '').slice(0, 80)),
          h('span', { style: { ...styles.muted, minWidth: '56px', textAlign: 'right' } }, (entry.latencyMs || 0) + 'ms'),
          h('span', { style: { ...styles.muted, minWidth: '40px', textAlign: 'right' } }, hhmm)),
        open ? h('div', { style: { padding: '2px 2px 12px 24px' } },
          entry.error ? h('div', { style: { color, fontSize: '12px', marginBottom: '6px' } }, entry.error) : null,
          h('pre', { style: { whiteSpace: 'pre-wrap', margin: 0, fontSize: '11px', maxHeight: '220px', overflow: 'auto',
            background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '8px' } },
            JSON.stringify(entry.value ?? {}, null, 1).slice(0, 4000)),
          h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
            h('button', { style: styles.button, onClick: () => onRerun(entry) }, '↻ 重跑'),
            h('button', { style: styles.button, disabled: importing, onClick: () => onImport(entry) },
              importing ? '…' : (entry.ok ? '导入到对话' : '导入错误到对话')))) : null)
    }

    function InfoPage(props) {
      const ctx = props.__ctx
      const lang = useLang(ctx)
      const { data, busy, reload } = useStatus()
      const [task, setTask] = React.useState('')
      const [running, setRunning] = React.useState('')
      const [history, setHistory] = React.useState(() => readHistory())
      const [importing, setImporting] = React.useState(0)
      const [notice, setNotice] = React.useState('')
      const eto = (data && data.eto) || {}
      const ok = Boolean(data && data.ok)
      const labelOf = key => (ACTION_LABEL[key] || { zh: key, en: key })[lang === 'zh' ? 'zh' : 'en']

      const push = entry => {
        setHistory(prev => {
          const next = [entry, ...prev].slice(0, HISTORY_MAX)
          writeHistory(next)
          return next
        })
      }

      const call = async (tool, args) => {
        const started = Date.now()
        const res = await fetch(API + '/run', {
          method: 'POST', headers: { ...HEADERS, 'content-type': 'application/json' },
          body: JSON.stringify({ tool, args }),
        })
        const out = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }))
        return { ok: out.ok === true, value: out.value, error: out.ok ? null : out.error, latencyMs: out.latencyMs ?? (Date.now() - started) }
      }

      const runAction = async action => {
        const input = task.trim()
        if (!input) { setNotice('先写点东西'); return }
        setNotice('')
        setRunning(action)
        const started = Date.now()
        try {
          if (action === 'route') {
            push({ action, input, at: started, ...(await call('eto_route', { task: input })) })
          } else if (action === 'clarify') {
            push({ action, input, at: started, ...(await call('eto_clarify', { task: input })) })
          } else if (action === 'consensus') {
            setNotice('评审会真调 LLM，可能要几十秒…')
            push({ action, input, at: started, ...(await call('eto_consensus', { plan: input })) })
          } else if (action === 'flow') {
            setNotice('完整流程：路由 → 评审 → 记忆…')
            const route = await call('eto_route', { task: input })
            push({ action: 'route', input, at: started, ...route })
            const review = await call('eto_consensus', { plan: input })
            push({ action: 'consensus', input, at: Date.now(), ...review })
            await call('eto_memory_write', {
              key: 'flow:last',
              value_json: JSON.stringify({ task: input, route: route.value, review: review.value, at: started }),
            })
            setNotice('完整流程完成，结果存到 flow:last')
          }
        } catch (e) {
          push({ action, input, at: started, ok: false, error: String(e), latencyMs: Date.now() - started })
        } finally { setRunning(''); reload() }
      }

      const rerun = entry => { setTask(entry.input || ''); runAction(entry.action) }

      const importEntry = async entry => {
        setImporting(entry.at)
        try {
          const body = entry.ok
            ? 'ETO 的「' + labelOf(entry.action) + '」结果，请据此继续推进。\n\n输入：' + entry.input +
              '\n\n结果：\n```json\n' + JSON.stringify(entry.value, null, 2).slice(0, 3000) + '\n```'
            : 'ETO 的「' + labelOf(entry.action) + '」失败了，帮我排查。\n\n输入：' + entry.input + '\n\n错误：' + entry.error
          await importToConversation(ctx, body)
          setNotice('已导入到新会话')
        } catch (e) {
          setNotice('导入失败：' + (e && e.message ? e.message : String(e)))
        } finally { setImporting(0) }
      }

      const pill = { fontSize: '11px', padding: '3px 9px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)' }
      const actionBtn = (key, primary) => h('button', {
        key, disabled: running !== '',
        style: { ...styles.button, ...(primary ? { fontWeight: 600 } : {}) },
        onClick: () => runAction(key),
      }, running === key ? '…' : labelOf(key))

      return h('div', { style: { ...styles.page, padding: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
          h('h2', { style: { ...styles.title, margin: 0 } }, 'ETO'),
          h('span', { style: { ...pill, color: ok ? 'var(--dsw-alias-label-positive, #2ecc71)' : 'var(--dsw-alias-label-critical, #e74c3c)' } }, ok ? '✓' : '✗'),
          h('span', { style: pill }, (eto.version || '?') + ' · ' + String(eto.commit || '?').slice(0, 7)),
          h('span', { style: { flex: 1 } }),
          h('button', { style: styles.button, onClick: () => reload({ fresh: true }), disabled: busy }, busy ? '…' : '↻')),
        h('div', { style: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' } },
          h('textarea', {
            value: task, onChange: e => setTask(e.target.value),
            placeholder: '你要做什么？写个任务或方案，然后选下面的动作…',
            style: { ...styles.input, minHeight: '76px', resize: 'vertical', fontSize: '13px', lineHeight: 1.5 },
          }),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            actionBtn('route'), actionBtn('clarify'), actionBtn('consensus'), actionBtn('flow', true)),
          notice ? h('div', { style: { ...styles.muted, fontSize: '12px' } }, notice) : null),
        h('div', { style: { padding: '0 16px 8px', display: 'flex', alignItems: 'center', gap: '10px' } },
          h('div', { style: styles.cardTitle }, '最近'),
          h('span', { style: { flex: 1 } }),
          history.length ? h('button', {
            style: { ...styles.button, fontSize: '11px' },
            onClick: () => { setHistory([]); writeHistory([]) },
          }, '清空') : null),
        h('div', { style: { ...styles.body, padding: '0 16px 16px', gap: 0 } },
          history.length === 0
            ? h('div', { style: styles.muted }, '还没有记录。上面写点什么，点个动作试试。')
            : history.map(entry => h(TimelineEntry, {
                key: entry.at, entry, label: labelOf(entry.action),
                onRerun: rerun, onImport: importEntry, importing: importing === entry.at,
              }))))
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
      const [testing, setTesting] = React.useState(false)

      const value = snapshot && snapshot.value ? snapshot.value : null
      React.useEffect(() => {
        if (value !== null) setDraft({ ...value })
      }, [value && JSON.stringify(value)])

      const set = (key) => (next) => setDraft((current) => ({ ...(current || {}), [key]: next }))

      const save = async () => {
        if (!form || !draft) return
        setState('saving')
        setMessage(null)
        try {
          const ops = []
          const scalar = ['repo', 'venv', 'python', 'peerScoreProvider', 'peerScoreModel', 'toolTimeoutMs', 'peerScoreTimeoutMs']
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
          if (ops.length === 0) {
            setState('idle')
            return
          }
          const accepted = await form.mutate(ops)
          setState(accepted ? 'saved' : 'failed')
          if (!accepted) setMessage(t.saveFailed)
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
