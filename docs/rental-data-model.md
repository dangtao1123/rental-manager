# 租房模块数据层

租房模块使用 `data/rental.sqlite` 作为主存储，旧的 `rental-*.json` 文件作为迁移来源和回滚快照。首次调用租房接口时，服务会创建数据库、导入旧 JSON，并写入迁移标记。之后接口读取 SQLite；写入 SQLite 的同时更新 JSON 快照。

## 表和职责

- `rental_rooms`：小区、房间、状态、面积、物业费、房东托管信息。
- `rental_leases`：租户入住租约、租金周期、押金、入住水电表、交费至日期。
- `rental_renewals`：每次续费的时长、金额、起止日期和历史快照。
- `rental_bills`：按租约生成的应收账单。
- `rental_maintenance`：维护事项、状态、费用和图片引用。
- `rental_items`：房间物品及照片引用。
- `rental_checkouts`：退房结算、表读数、扣费和押金返还。
- `rental_costs`：水、电、物业及其他成本。
- `rental_ledger`：收入和支出流水。
- `rental_meta`：迁移标记和系统设置。
- `rental_tenants`：从租约历史汇总出的租户档案，后续可独立维护联系人和历史租约。
- `rental_landlords`、`rental_landlord_leases`：房东和托管合同的预留表。
- `rental_audit_log`：房间、租户、账单、维护、续费和设置的变更记录。

实体的完整业务字段暂时保存在 `data` JSON 列中，同时保留常用筛选字段和索引。这样可以先安全迁移现有数据，再逐步把字段拆成正式列，不影响现有接口和页面。

## 后续迁移顺序

1. 将 `tenantName`、`tenantPhone` 抽成 `tenants` 表，并让租约通过 `tenant_id` 关联。
2. 将房东托管信息抽成 `landlord_leases` 表，区分房东租期和租户租期。
3. 将水电读数抽成 `utility_readings` 表，按房间和读数日期建立唯一约束。
4. 将图片从业务记录中抽成 `documents` 表，后续接入对象存储。
5. 增加操作日志、权限角色和合同文档表。

任何字段迁移都应保留原 `data` JSON，完成数据校验后再删除旧字段或旧快照。
