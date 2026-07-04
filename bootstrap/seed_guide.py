"""种子使用指南 — 安装时写入 Pi 记忆系统

写入 ~/.eto/memory/guide.json，ETO 可在运行时注入上下文。
"""
import json
from pathlib import Path

GUIDE = {
    "version": "0.5.0",
    "sections": [
        {
            "id": "three-mirror-routing",
            "title": "三镜路由 — 任务自动分类",
            "source": "bootstrap/seed_guide.py / docs/usage.md",
            "tags": ["routing", "task-classification", "gewu", "direct", "plan", "consensus"],
            "body": "用户说话 → ETO 自动分类任务 → 路由到合适的 Agent。\n"
                    "三种路由：direct（简单问答直接回答）、plan（代码/调研/创建任务，拆步执行）、consensus（危险操作触发三阶段共识）。\n"
                    "路由后端配置 ~/.pi/eto-config.json，LLM 不可用时自动降级关键词匹配。",
        },
        {
            "id": "peer-consensus",
            "title": "同侪共识 — 三阶段评审",
            "source": "bootstrap/seed_guide.py / docs/usage.md",
            "tags": ["consensus", "peer-review", "voting", "scoring", "deliberation", "auditor"],
            "body": "风险操作由三个 AI peer 独立评分、审议、终审。\n"
                    "T1 独立评分 → T2 审议（分歧 > 0.2 时 peer 看到他人意见后重新评分）→ T3 终审（auditor 裁决）。\n"
                    "命令行：echo '{\"fn\":\"peer_review\",\"args\":[\"部署到生产环境不备份不测试\",[\"researcher\",\"coder\",\"auditor\"]]}' | python eto/stitches/consensus/vote.py",
        },
        {
            "id": "sentinel-v2",
            "title": "智子安检 v2 — AgentGuard 级行为规则引擎",
            "source": "bootstrap/seed_guide.py / docs/usage.md",
            "tags": ["sentinel", "security", "guard", "block", "confirm", "escape", "deadlock", "preview"],
            "body": "可配置规则引擎拦截危险操作，支持四种规则类型。\n"
                    "配置：~/.pi/eto-sentinel.json（热重载：对话中输入 /sentinel-reload）\n"
                    "规则类型：block（直接拦截）、confirm（弹窗确认+影响预览）、transform（正则替换 prompt）、track_turns（对话轮数提醒）。\n"
                    "逃生门：同规则在同一用户请求内连拦 N 次后自动放行，用户新消息重置计数。\n"
                    "trigger glob：支持 bash / write / edit / git:* 等工具名通配符匹配。\n"
                    "预览命令：检测到危险 bash 命令时自动生成安全预览（rm→ls, dd→lsblk）。",
        },
        {
            "id": "mcp-server",
            "title": "MCP Server — 被其他 Agent 调用",
            "source": "bootstrap/seed_guide.py / docs/usage.md",
            "tags": ["mcp", "server", "external", "integration", "tool"],
            "body": "ETO 作为 MCP Server 暴露 6 个工具：eto_consensus、eto_route、eto_peer_config、eto_memory_write/read/list。\n"
                    "配置：{ \"mcpServers\": { \"eto\": { \"command\": \"python\", \"args\": [\"-m\", \"eto.mcp_server\"] } } }",
        },
        {
            "id": "mcp-client",
            "title": "MCP Client — 调其他 Agent",
            "source": "bootstrap/seed_guide.py / docs/usage.md",
            "tags": ["mcp", "client", "peer", "dispatch", "provider"],
            "body": "Peer 可以通过 MCP 调外部 Agent。\n"
                    "配置 peers 段：{ \"provider\": \"mcp\", \"mcp_server\": [\"python\", \"-m\", \"my_agent_mcp\"], \"mcp_tool\": \"agent_execute\" }",
        },
        {
            "id": "shared-memory",
            "title": "共享记忆（TealContext）",
            "source": "bootstrap/seed_guide.py / docs/usage.md",
            "tags": ["memory", "shared", "tealcontext", "kv", "pi-team-agents"],
            "body": "Agent 之间通过 ~/.eto/shared_memory/{key}.json 共享上下文。\n"
                    "peer_review 自动写入评分+关切点，execute_plan 写入步骤状态。\n"
                    "格式与 pi-team-agents 兼容，两边数据互通。",
        },
        {
            "id": "fable-prompt",
            "title": "Fable 5 风格 Agent Prompt",
            "source": "bootstrap/seed_guide.py / docs/usage.md / eto/extensions/eto.ts",
            "tags": ["fable", "prompt", "agent-prompt", "communication", "action-safety", "tone"],
            "body": "所有 plan 路由的 Agent 注入 AGENT_PROMPT：\n"
                    "Communication：先说结论再说证据，无废话无庆祝。\n"
                    "Action Safety：审计每条声明，错误直接叫错并修复。\n"
                    "Tone：无 emoji（除非要求），Done 在验证前是假设。",
        },
        {
            "id": "development-workflow",
            "title": "开发工作流（层 A：ETO 自身开发）",
            "source": "bootstrap/seed_guide.py / docs/usage.md / .claude/rules/eto-guide.md",
            "tags": ["development", "workflow", "reasonix", "release", "slash-command"],
            "body": "描述需求 → /plan-eto → Reasonix 实现 → 审计 → /test-eto → /release-eto\n"
                    "slash 命令：/plan-eto（写 plan）、/code-eto（触发 Reasonix）、/test-eto（跑测试）、/review-eto（审计）、/release-eto（发布）\n"
                    "测试：python eto/stitches/test.py（期望 17/17 PASS）",
        },
    ],
}


def init(force: bool = False) -> dict:
    p = Path.home() / ".eto" / "memory" / "guide.json"
    if p.exists() and not force:
        return {"step": "guide", "status": "skipped"}
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(GUIDE, ensure_ascii=False, indent=2), "utf-8")
    return {"step": "guide", "status": "ok", "sections": len(GUIDE["sections"])}
