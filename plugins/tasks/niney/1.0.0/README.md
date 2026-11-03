# niney@1.0.0

9Y API 视频任务插件，仅白名单 `DB-SD-2.5`。详见仓库根目录 [README.md](../../../../README.md)。

- 渠道 Base URL：`https://9yapi.shop`（不要带 `/v1`；`www.9yapi.shop` 也可）
- 鉴权：Bearer API Key（写在渠道密钥里，不要写进插件）
- 协议：`openai_video` → `POST /v1/videos`、`GET /v1/videos/:task_id`、`GET|HEAD /v1/videos/:task_id/content`
- 固定 `seconds=30`、`resolution=720p`。参考图必须已是公开 HTTPS URL；本插件不代为上传
