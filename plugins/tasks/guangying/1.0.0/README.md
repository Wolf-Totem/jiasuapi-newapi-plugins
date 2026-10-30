# guangying@1.0.0

光影 AI 竖屏 Seedance 2.0 视频任务插件。详见仓库根目录 [README.md](../../../../README.md)。

- 渠道 Base URL：`https://guangying.store`（不要带 `/v1`；`www.guangying.store` 也可）
- 鉴权：Bearer API Key，写在渠道密钥里
- 创建：`POST /v1/video/generations`（另加 `Idempotency-Key`）
- 查询：`GET /v1/tasks/{id}`
- 协议：主机 `openai_video`（`/v1/videos`）；上游路径不是 `/v1/videos`
- 白名单：`gy-model-13`、`gy-model-20`、`gy-model-19`
- 参考素材只接受光影 `fileId`。只传 URL 会返回 `plugin_request_invalid`
- 不声明 `channelTypes`。渠道类型选任务插件，绑定 `guangying`
