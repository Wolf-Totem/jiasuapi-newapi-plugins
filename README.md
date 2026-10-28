# 佳速API · NewAPI 任务插件市场源

面向 **其他 NewAPI 实例** 的 GitHub 市场源。本仓库现有三个任务插件：`jiasuapi`（佳速API 图片 / 视频）、`sd25_video`（sd25.app 上的 Seedance 2.5 视频，见下方「SD2.5 视频」）和 `megabyai`（MegaAi 视频，见下方「MegaAi 视频」）。

## 佳速API（`jiasuapi`）

安装 `jiasuapi` 后，可将 [佳速API](https://ai.jiasuapi.com/) 作为图片 / 视频生成上游。

- 官方地址：https://ai.jiasuapi.com/
- 插件 key：`jiasuapi`
- 当前版本：`1.0.2`
- 描述：佳速API中转平台（图片、视频中转平台）。官方地址：https://ai.jiasuapi.com/
- 市场源 `index.json`（raw）：

```text
https://raw.githubusercontent.com/hyc0122/jiasuapi-newapi-plugins/main/index.json
```

## 下游安装步骤（简要）

### 1. 添加市场源

1. 以管理员登录你的 NewAPI 控制台
2. 打开 **任务插件 → 市场源**
3. 新增源，名称任意（如「佳速API」），URL 填上面的 raw `index.json`
4. 保存后刷新市场列表，应能看到 **佳速API**

### 2. 安装插件

1. 在市场中找到 **佳速API**（`jiasuapi@1.0.2`）
2. 安装并启用
3. 也可手动上传本仓库 `plugins/tasks/jiasuapi/1.0.2/plugin.js`

### 3. 创建 Task Plugin 渠道

1. 新建渠道，类型选择 **任务插件**（Task Plugin）
2. **绑定插件**：`jiasuapi`
3. **Base URL**：`https://ai.jiasuapi.com`（不要末尾斜杠；留空时插件默认也用该地址）
4. **密钥**：填写佳速API 的 Bearer API Key（`sk-…`）
5. **模型**：以渠道侧可见模型为准；权威列表见下方「模型列表」

> 本插件不声明 `channelTypes`，请始终使用「任务插件」渠道绑定。

## 模型列表

### 重要：`GET /v1/models` 是按 Key 鉴权限流的

佳速 `GET /v1/models` **只返回当前 Bearer Token 所属分组 / 额度能用的模型**，不是全站目录。同一站点不同 Key 可能看到 8 个、十几个或更多，且 **不一定包含** `gpt-image-2.5-sunburst-1k`。

**运营方 / 调用方请用自己的 Key 查询自己能调的模型：**

```bash
curl -sS "https://ai.jiasuapi.com/v1/models" \
  -H "Authorization: Bearer $JIASU_API_KEY"
```

### 市场插件包内的列表如何生成

`meta.models`（及路由 / 协议子集）是发布时的快照，便于市场卡片展示与渠道勾选。本版采用：

1. Token 的 `GET /v1/models`（鉴权范围，可能不完整）
2. **UNION** 平台目录（Postgres `models` 表 / 可选公开 `/api/pricing`）
3. 排除非中转公开产品：`face-style`
4. 排除私有变体 `*-不重试`、`*-KiLig`（除非该 id 出现在 Token 的 `/v1/models` 中）
5. **强制写入** `gpt-image-2.5-sunburst-1k`（单连字符）；已移除错误的 `gpt-image-2.5--sunburst-1k`

因此：**市场插件列表 = 目录 ∪ 强制 sunburst（经上述过滤）**；**你账号实际可调模型 = 你自己的 `GET /v1/models`**。

同步脚本：

```bash
# JIASU_API_KEY：Bearer，用于鉴权 /v1/models（勿提交仓库；可从本地 .sync-token 导出）
# export JIASU_API_KEY="$(tr -d '\n' < .sync-token)"
#
# --extra-models-file：平台目录快照（一行一个 model_name，或 name|endpoints|tags）
# --include-pricing：额外 UNION 公开 /api/pricing
JIASU_API_KEY=sk-... node scripts/sync-models.mjs --version 1.0.2 \
  --extra-models-file scripts/db-models.snapshot.txt \
  --include-pricing
```

## 三层路径说明

下游 NewAPI 上实际暴露的调用面分三层；插件只声明原生调试路由，**不会**把主机公开路径写进 `meta.routes`（否则会挤占主机路由）。

### 1) 主机 jsapi 公开路径（推荐）

由 **NewAPI 主机** 提供，转发到本插件 Driver（`buildSubmitRequest` / `buildQueryRequest` 等），上游映射到佳速：

| 方法 | 下游路径 | 映射到佳速 |
| --- | --- | --- |
| `GET` | `/v1/models` | `GET https://ai.jiasuapi.com/v1/models`（主机/渠道侧模型发现；请用佳速 Key） |
| `POST` | `/v1/video/generations` | `POST /v1/video/generations` |
| `GET` | `/v1/videos/tasks/:task_id` | `GET /v1/videos/tasks/:task_id` |
| `POST` | `/v1/images/create` | `POST /v1/images/create` |
| `GET` | `/v1/images/tasks/:task_id` | `GET /v1/images/tasks/:task_id` |

### 2) `openai_video` 协议路径

插件在 `meta.protocols` 中声明 `openai_video`（视频模型）。主机 Pin 后可用 OpenAI Videos 形态：

| 方法 | 下游路径 | 说明 / 佳速映射 |
| --- | --- | --- |
| `POST` | `/v1/videos` | create → 插件 decode 后走 `POST /v1/video/generations` |
| `GET` | `/v1/videos/:task_id` | retrieve → 插件 render；查询佳速 `GET /v1/videos/tasks/:id` |
| `GET`/`HEAD` | `/v1/videos/:task_id/content` | content → `listArtifacts` / `buildContentRequest`（公开 CDN URL，credentialless） |

### 3) 原生调试路径 `/jiasuapi/...`

插件 `meta.routes` 声明，便于直接打插件原生编解码（不经主机 jsapi 封装）：

| 方法 | 路径 | 映射到佳速 |
| --- | --- | --- |
| `POST` | `/jiasuapi/v1/videos/generations` | `POST /v1/video/generations` |
| `POST` | `/jiasuapi/v1/images/create` | `POST /v1/images/create` |
| `GET` | `/jiasuapi/v1/videos/tasks/:task_id` | `GET /v1/videos/tasks/:task_id` |
| `GET` | `/jiasuapi/v1/images/tasks/:task_id` | `GET /v1/images/tasks/:task_id` |

## 视频参数映射（调用方 → 佳速）

下游无论走主机 jsapi（`POST /v1/video/generations`）、`openai_video`（`POST /v1/videos`）还是原生 `/jiasuapi/...`，最终都会打到佳速 `POST /v1/video/generations`。下表只列**调用方请求字段**与佳速接受字段的对应关系（与官方公开参数一致）。

### 必填

| 调用方字段 | 佳速字段 | 说明 |
| --- | --- | --- |
| `model` | `model` | 视频模型 id（如 `seedance-2.5-101010`） |
| `prompt` | `prompt` | 文本提示词；可用 `@图片N` / `@视频N` / `@音频N` 或自定义素材名引用 |

### 可选

| 调用方字段（含兼容别名） | 佳速字段 | 说明 |
| --- | --- | --- |
| `duration` 或 `seconds` | `duration` | 秒数；`seconds` 为 OpenAI Videos / Sora 兼容写法。默认由上游按模型处理（常见默认 `5`）；`2.0-*` 约 4–15，`2.5-*` 约 4–30 |
| `ratio` 或 `aspect_ratio` | `ratio` | `16:9` / `9:16` / `1:1`；别名统一写成佳速的 `ratio` |
| `resolution` 或 `video_resolution` | `resolution` | `480p` / `720p` / `1080p`；默认常见为 `720p` |
| `images`、`image_urls`、`image`、`input_reference` | `images` | URL 字符串，或 `{url, name?, type?}`。`type`：`first_frame` / `end_frame`（入站也接受 `last_frame`）。无 `type` 为参考图。`input_reference` / 单张 `image` 为 Sora 兼容参考图 |
| `videos` | `videos` | URL 或 `{url, name?}` |
| `audios` | `audios` | URL 或 `{url, name?}`；勿与 `images[].type` 首尾帧同时使用 |
| `materials` | `materials` | 可选 `[{type, url, name?}]` |
| `face` | `face` | 可选。`{"enabled":true,"mode":"light"}`（或 `heavy`），或 `{"enabled":false}`；省略则走服务端默认处理 |

以上字段也可放在 `metadata` 对象内（如 `metadata.ratio`、`metadata.images`），效果与顶层相同。

### openai_video（`POST /v1/videos`）速查

| OpenAI / Sora 常见字段 | 映射到佳速 |
| --- | --- |
| `model` | `model` |
| `prompt` | `prompt` |
| `seconds` | `duration` |
| `input_reference`（URL 或文件） | `images` |
| `ratio` / `aspect_ratio` | `ratio` |
| `resolution` | `resolution` |

说明：OpenAI Videos 的像素 `size`（如 `1280x720`）**不是**佳速视频字段；请直接传 `ratio` / `aspect_ratio` 与 `resolution`，不要只传 `size`。

### 不要传的顶层字段

不要传 `first_frame_url` / `end_frame_url` / `start_frame` / `end_frame` / `function_mode`；首尾帧请用 `images[].type`（`first_frame` / `end_frame`）。

## 调用示例

视频（主机 jsapi）：

```bash
curl -sS -X POST "$YOUR_NEW_API/v1/video/generations" \
  -H "Authorization: Bearer $YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "seedance-2.5-101010",
    "prompt": "城市夜景延时",
    "duration": 5,
    "ratio": "16:9",
    "resolution": "720p"
  }'
```

图片：

```bash
curl -sS -X POST "$YOUR_NEW_API/v1/images/create" \
  -H "Authorization: Bearer $YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2.5-sunburst-1k",
    "prompt": "一只柴犬坐在樱花树下"
  }'
```

查询：

- 视频：`GET /v1/videos/tasks/:task_id`
- 图片：`GET /v1/images/tasks/:task_id`

## SD2.5 视频（`sd25_video`）

- 插件 key：`sd25_video`
- 当前版本：`1.1.2`（`1.1.0`、`1.1.1` 仍保留）
- 默认 Base URL：`https://sd25.app`（渠道里已填写的 Base URL 优先；插件不内置密钥。插件 `meta` 不写 `website` / `baseUrl` / `author.url`）
- 协议：`openai_video`（`POST /v1/videos`、`GET /v1/videos/:task_id`、`GET|HEAD /v1/videos/:task_id/content`）
- 发给上游的 `model` 恒为 `seedance-2.5`
- 画幅保留 `16:9` / `9:16` / `4:3` / `3:4` / `1:1` / `21:9` / `adaptive`。分辨率仍为 `480p` / `720p` / `1080p`

上游接受两种等价写法：像素 `size`（如 `1280x720`），或成对的 `resolution` + `aspect_ratio`（如 `720p` + `16:9`）。三者同时出现且不一致时上游会拒绝。查询结果仍返回 `size`。

客户端已经带了合法分辨率（`resolution` / `video_resolution`，或 `size` 为 `480p` / `720p` / `1080p`）时，`decodeRequest` 和出站 `POST /v1/videos` 保留 `resolution` 与 `aspect_ratio`（`ratio` / `aspect` 映射为 `aspect_ratio`），不再改写成只有像素 `size`。主机按 `resolution` / `video_resolution` 计费时因此能看到客户端档位，不会因为缺字段注入模型默认 `720p`。只传像素 `size`（含 `adaptive-480p` / `adaptive-720p` / `adaptive-1080p`）时仍只发 `size`。缺画幅时默认 `16:9`。显式画幅优先；否则用像素 `size` 暗示的画幅。会和分辨率冲突的像素 `size` 不一并发出。认不出的 `size` 或画幅会返回参数错误。

可 pin 的名字（`meta.models` 与 `protocols.openai_video.models`）：

| 名字 | 用途 |
| --- | --- |
| `seedance-2.5` | 上游字面量 |
| `seedance-2.5-app-秒` | param_routing 按秒渠 |
| `seedance-2.5-app-条` | param_routing 按条渠 |
| `sd2.5-G3-特惠-1` / `sd2.5-G3-特惠-2` | facade 对外名。同模式的 `sd2.5-G3-特惠-N` 在提交时也可接受 |

`decodeRequest` 返回的 model 等于主机 pin 的名字。`buildSubmitRequest` 接受 OriginModelName、别名和 UpstreamModelName，请求体里的 model 仍写成 `seedance-2.5`。

## MegaAi 视频（`megabyai`）

- 插件 key：`megabyai`
- 当前版本：`1.0.0`
- 显示名：MegaAi
- 官方文档：https://megaviews.top/docs （https://newapi.megabyai.cc/docs 是同一份文档）
- 站点：`https://megaviews.top`，也可使用 `https://www.megaviews.top`、`https://newapi.megaviews.top`、`https://newapi.megabyai.cc`
- 协议：`openai_video`（主机路径 `POST /v1/videos`、`GET /v1/videos/:task_id`、`GET|HEAD /v1/videos/:task_id/content`）
- 不声明 `channelTypes`。新建渠道时类型选 **任务插件**，绑定插件 `megabyai`
- 插件文件不包含密钥。不要对上游做付费试提交

渠道 **Base URL** 填站点根地址，例如 `https://megaviews.top`（不要末尾斜杠，不要自带 `/v1`）。插件按 QuantumNous `openai_video` 拼接 `/v1/videos`。若渠道已写成 OpenAI SDK 习惯的 `https://megaviews.top/v1`，插件会去掉末尾这一段 `/v1`，避免请求打到 `/v1/v1/videos`。

鉴权为 `Authorization: Bearer <渠道密钥>`。

上游就是 MegaAi 文档里的视频任务，插件不另做一套字段改写：

| 步骤 | 上游 |
| --- | --- |
| 创建 | `POST /v1/videos`（JSON 或 multipart） |
| 查询 | `GET /v1/videos/{task_id}` |
| 成片 | `GET` 或 `HEAD /v1/videos/{task_id}/content` |

JSON 原样转发文档字段：`model`、`prompt`、`duration`、`ratio`、`resolution`、`seed`、`referenceImages`、`referenceVideos`、`referenceAudios`、`metadata`。部分渠道使用的 `seconds`、`size`、`image`、`input_reference` 同样原样转发。`seconds` 与 `duration` 只在校验时互相认读（1–3600 秒，与官方 Sora 任务插件一致）；JSON 体不会把 `duration` 改写成 `seconds`。multipart 与官方 Sora 插件相同：表单只有 `duration` 时，会同时带上数值 `seconds`。出站 `model` 使用渠道模型映射后的名字；没有映射时与客户端模型一致。

任务 ID 读取 `id` 或 `task_id`。兼容响应若把它们放在嵌套的 `data` 里，也从 `data.id` / `data.task_id` 读取。状态 `queued`、`in_progress`、`completed`、`failed`；文档里的兼容状态 `succeeded` 视为成功。认不出的状态保持未知，不会当成进行中。

计费用量只申报 `seconds`（单位秒），取请求或完成结果中的 `duration` / `seconds`。插件不写价格或倍率。

可 pin 的视频模型（`meta.models` 与 `protocols.openai_video.models`，共 22 个；不含对话 / 图片模型）：

`S-seedance-2.5-480p`、`T1-seedance-2.5`、`T2-seedance-2.5`、`T3-seedance-2.5`、`bb-2.5-301010`、`minimax-h3-f`、`minimax_h3_zm_u24`、`sd-2.0`、`sd-2.5-720p`、`sd-fast`、`sd-mini`、`sd2.5-pro`、`sd2.5max900`、`seedance-2.0-fast-m1`、`seedance-2.0-m1`、`seedance-2.0-mini-m1`、`seedance-2.5-m1`、`seedance-2.5-m3`、`video-sd20-10s`、`wan-3.0`、`wan3.0-video`、`wan3.0-video-prime`

本插件不注册 `/megabyai/...` 或公开的 `/v1/videos`。主机协议路径仍由 `openai_video` 提供。

## 仓库结构

```text
index.json
README.md
scripts/sync-models.mjs
scripts/db-models.snapshot.txt
scripts/last-sync.json
plugins/tasks/jiasuapi/1.0.0/plugin.js
plugins/tasks/jiasuapi/1.0.1/plugin.js
plugins/tasks/jiasuapi/1.0.2/plugin.js
plugins/tasks/sd25_video/1.1.0/plugin.js
plugins/tasks/sd25_video/1.1.0/golden.json
plugins/tasks/sd25_video/1.1.1/plugin.js
plugins/tasks/sd25_video/1.1.1/golden.json
plugins/tasks/sd25_video/1.1.2/plugin.js
plugins/tasks/sd25_video/1.1.2/golden.json
plugins/tasks/megabyai/1.0.0/plugin.js
plugins/tasks/megabyai/1.0.0/README.md
```

## 本地校验

```bash
node --check plugins/tasks/jiasuapi/1.0.2/plugin.js
sha256sum plugins/tasks/jiasuapi/1.0.2/plugin.js   # 应与 index.json versions[].sha256 一致
node --check plugins/tasks/sd25_video/1.1.2/plugin.js
sha256sum plugins/tasks/sd25_video/1.1.2/plugin.js   # 应与 index.json versions[].sha256 一致
node --check plugins/tasks/megabyai/1.0.0/plugin.js
sha256sum plugins/tasks/megabyai/1.0.0/plugin.js   # 应与 index.json versions[].sha256 一致
```

若本机有 NewAPI 源码：

```bash
go run . plugin lint /path/to/plugins/tasks/jiasuapi/1.0.2/plugin.js
```
