"""Governance — 权限绑定（permit）与任务预算（budget）。

requirements FR-D3 的最小可行实现：
- permit: agent 名 × 操作类型 白名单（FR-D3.1）
- budget: 任务级预算帽，至少覆盖工具调用次数（FR-D3.2 / FR-D3.3）

两者都由 mcp_dispatch.dispatch_with_spec 在调用工具前强制执行；
拒绝/超限返回可定位的错误信息并在 stderr 留 JSON 日志，禁止静默截断。
"""
