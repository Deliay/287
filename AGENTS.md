# 开发流程规范

本项目所有开发工作必须遵循以下规范，任何 Agent 或开发者在开始编码前必须完成前置流程。

## 1. 开发前置流程

```
产品需求 → UI/UX → 等待 Review → 技术方案 → 技术实现方案 → 进行开发
```

各阶段说明：

| 阶段 | 产出物 | 存放路径 | 完成条件 |
|------|--------|----------|----------|
| 产品需求 | 需求文档（PRD） | `docs/product/requirement/` | 需求描述、验收标准明确 |
| UI/UX | 设计稿、交互说明 | `docs/product/design/` | 覆盖需求中的全部用户场景 |
| **等待 Review** | Review 记录 | 需求与设计文档内 | **需求 + 设计均通过 Review 后才能进入技术阶段** |
| 技术方案 | 技术方案文档 | `docs/engineering/proposal/` | 技术选型、架构、风险明确并通过评审 |
| 技术实现方案 | 实现计划 | `docs/engineering/plan/` | 拆解为可执行任务，包含测试计划 |
| 进行开发 | 代码 + 测试 | 源码目录 | 遵循 TDD 流程（见下） |

**硬性约束：**
- 未完成对应前置文档，不得进入下一阶段。
- Review 不通过时，回到对应阶段修改文档，直至通过。
- 开发过程中需求或方案发生变更，必须先更新对应文档，再改代码。

## 2. 文档路径约定

| 文档类型 | 目录 |
|----------|------|
| 产品需求 | `docs/product/requirement/` |
| UI/UX | `docs/product/design/` |
| 技术方案 | `docs/engineering/proposal/` |
| 技术实现方案 | `docs/engineering/plan/` |

各目录的详细规范见对应目录下的 `AGENTS.md`。

## 3. TDD 开发规范（红-绿-重构）

所有代码开发必须采用 TDD（测试驱动开发），严格遵循 **红 → 绿 → 重构** 循环：

1. **红（Red UT）**：先编写一个失败的单元测试。
   - 测试描述一个尚未实现的行为。
   - 运行测试，确认它**因预期原因失败**（不是编译错误或语法错误）。
2. **绿（Green UT）**：编写**最小量**的生产代码使测试通过。
   - 只写刚好让测试变绿的代码，不提前实现后续需求。
   - 运行全部测试，确认全部通过。
3. **重构（Refactor）**：在测试保持绿色的前提下改进代码。
   - 消除重复、改善命名与结构。
   - 每次重构后重新运行全部测试，必须保持全绿。
   - 重构阶段**不得新增行为**。

重复以上循环，直到功能完成。

**硬性约束：**
- 禁止先写实现后补测试。
- 提交代码前，所有测试必须通过。
- 每个红-绿-重构循环应尽量小（几分钟内完成一轮）。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
