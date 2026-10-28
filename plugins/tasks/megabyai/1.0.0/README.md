# megabyai@1.0.0

MegaAi 视频任务插件。详见仓库根目录 [README.md](../../../../README.md)。

- 渠道 Base URL：`https://megaviews.top`（不要带 `/v1`；`www`、`newapi.megaviews.top`、`newapi.megabyai.cc` 也可）
- 鉴权：Bearer API Key（写在渠道密钥里，不要写进插件）
- 协议：`openai_video` → `POST /v1/videos`、`GET /v1/videos/:task_id`、`GET|HEAD /v1/videos/:task_id/content`
