# docs 目录规范

本目录存放项目全生命周期文档，结构对应开发前置流程的各阶段：

```
docs/
├── product/
│   ├── requirement/   # 产品需求文档（PRD）
│   └── design/        # UI/UX 设计文档
└── engineering/
    ├── proposal/      # 技术方案文档
    └── plan/          # 技术实现方案文档
```

## 通用约定

- 文档统一使用 Markdown（`.md`）编写。
- 文件名使用小写 kebab-case，建议以日期或序号前缀排序，如 `2026-09-23-user-login.md` 或 `001-user-login.md`。
- 同一主题的需求、设计、方案、实现文档应使用相同的主题名，便于跨目录关联，例如：
  - `product/requirement/user-login.md`
  - `product/design/user-login.md`
  - `engineering/proposal/user-login.md`
  - `engineering/plan/user-login.md`
- 文档内容发生实质性变更时，应同步更新依赖它的下游文档（需求变更 → 更新设计 → 更新技术方案 → 更新实现计划）。
- 每个子目录的具体规范见该目录下的 `AGENTS.md`。
