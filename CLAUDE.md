# Firewise API — CLAUDE.md

## 每次对话开始时必读

1. `../firewise-web/docs/loop.md` — 工作流程
2. `../firewise-web/docs/todo/` — 当前任务列表
3. `../firewise-web/docs/product.md` — 产品功能全貌
4. `../firewise-web/docs/architecture.md` — 技术架构

---

# 后端开发规范

## 项目结构

```
src/
├── controllers/   — 业务逻辑
├── routes/        — 路由定义
├── middleware/    — auth、error、logger
├── utils/         — 工具函数
│   ├── family-context.ts    — 获取 belong_id（必须用这个，不要直接用 user_id）
│   ├── currency-conversion.ts — 汇率转换
│   └── portfolio-calc.ts    — 持仓计算
└── config/
    └── supabase.ts          — supabaseAdmin client
```

## 关键规范

### 鉴权
- 所有 `/api/*` 路由都需要 JWT 鉴权
- 使用 `req.user!.id` 获取用户 ID
- **必须**通过 `getViewContext(req)` 获取 `belongId`，不要直接用 `userId` 查数据

### belong_id
- 所有数据都按 `belong_id`（= `family_id`）隔离，不是按 `user_id`
- 个人用户也有一个 personal family，通过 `/fire/families/ensure-personal` 创建

### 错误处理
- 业务错误用 `throw new AppError('message', statusCode)`
- catch 块里区分 `AppError` 和未知错误
- **不要**把真实错误信息吞掉，用 `console.error` 打印后再返回

### 数据库
- 使用 `supabaseAdmin`（bypass RLS），不要用 `supabaseClient`
- migration 文件放 `supabase/migrations/`，按序号命名（当前最新：006）

## 已知问题 / 技术债

- `monthly_financial_snapshots` 表不存在，`/fire/snapshots` 接口返回空数组（PGRST205 错误已处理）
- `trades` 表无 `dca_plan_id` 字段，DCA 来源的 trade 通过 `notes = 'DCA'` 识别
- SE 市场（瑞典）已加入验证白名单，需在 Supabase 执行 `supabase/migrations/006_add_se_market.sql`

## 市场与货币对应

| Market | Currency |
|--------|----------|
| US | USD |
| SGX | SGD |
| HK | HKD |
| CN | CNY |
| SE | SEK |
| COMMODITY | 各自货币 |
