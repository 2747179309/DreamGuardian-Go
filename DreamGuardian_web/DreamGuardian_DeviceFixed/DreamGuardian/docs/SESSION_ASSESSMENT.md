# 本次睡眠评估接口

时间轴右侧评估仅在 `sleep_guide.timer.running === false` 且 `ended_unix > started_unix` 时读取本次报告。时间为 Unix 秒；短暂清醒、离床及深睡安全锁均不作为结束标志。

后端须提供 `sleep_guide.timer.session_id`（或 `sample.session_id`），对应 `/api/sleep/reports/{session_id}`。响应采用已有 `assessment`、`suggestions` 数组，并支持 `score` 或 `sleep_score`（0–100）、`issues` 字符串数组。没有报告或有效分数显示 `--`，不把短时实时睡眠分数冒充整夜评分。现有离线模拟始终处于进行中，不代表真实结束报告。

时长、已观测浅深睡及覆盖率取本次开始到结束之间的历史记录，不随时间轴缩放变化；不足 80% 提示历史覆盖不足。后端应根据完整会话计算综合评分与问题建议；前端不进行医学诊断。

事件详情展示事件的 `metrics` / `snapshot` 快照：`heart_bpm`、`breath_bpm`、`motion`（或 `csi_motion`）、`wake_risk`、`temperature_c`、`humidity_percent`（或 `humidity_pct`）。缺失显示 `--`，禁止以当前实时值补齐历史快照。

验证：`node tools/test-session-assessment.cjs`。
