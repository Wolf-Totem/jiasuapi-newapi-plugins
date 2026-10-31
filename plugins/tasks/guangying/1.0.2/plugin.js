/**
 * 光影 AI (guangying) — NewAPI Task Plugin API v1.
 *
 * Vendor (channel base is the site origin, for example https://guangying.store):
 *   POST /v1/video/generations   (Bearer + Idempotency-Key)
 *   GET  /v1/tasks/{id}
 * The create path is not /v1/videos. openai_video is still claimed because that
 * protocol is the host's client surface (POST /v1/videos). This driver translates
 * it, the same way jiasuapi posts to /v1/video/generations. Native debug routes
 * stay under /guangying/ and do not register the host's /v1/videos.
 *
 * Whitelist is the three vertical Seedance 2.0 models from the 2026-10-30
 * public GET /v1/models snapshot. gy-model-30 and gy-model-21 are not included.
 * Bind a Task Plugin channel with task_plugin_key guangying. No channelTypes.
 * No API key is embedded. This plugin does not upload media.
 * 1.0.2: claimedModel accepts param_routing select/internal body.model.
 */
const UPSTREAM_MODELS = [
  "gy-model-13", // 竖屏-Seedance 2.0
  "gy-model-20", // 竖屏-Seedance 2.0 Fast
  "gy-model-19", // 竖屏-Seedance 2.0 Mini
];

const MODEL_RULES = {
  "gy-model-13": {
    name: "竖屏-Seedance 2.0",
    minDuration: 4,
    maxDuration: 15,
    ratioMode: "9:16",
    minImages: 0,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    maxReferences: 12,
    textToVideo: true,
  },
  "gy-model-20": {
    name: "竖屏-Seedance 2.0 Fast",
    minDuration: 5,
    maxDuration: 15,
    ratioMode: "AUTO",
    minImages: 1,
    maxImages: 8,
    maxVideos: 0,
    maxAudios: 0,
    maxReferences: 8,
    textToVideo: false,
  },
  "gy-model-19": {
    name: "竖屏-Seedance 2.0 Mini",
    minDuration: 5,
    maxDuration: 15,
    ratioMode: "AUTO",
    minImages: 1,
    maxImages: 8,
    maxVideos: 0,
    maxAudios: 0,
    maxReferences: 8,
    textToVideo: false,
  },
};

const REQUIRES_ATTENTION_REASON =
  "requires_attention：上游已停止自动重试，需要联系光影运营核对。该状态不是已确认的生成失败，也不能当作自动退款依据。";

export const meta = {
  apiVersion: 1,
  key: "guangying",
  name: "光影 AI",
  icon: "text:光影",
  description: {
    en: "Portrait Seedance 2.0 video on guangying.store. Three vertical models at 720p; reference media must already be a Guangying fileId",
    zh: "通过光影 AI（guangying.store）生成竖屏 Seedance 2.0 视频。仅三个竖屏模型，720p，参考素材必须已是光影 fileId",
  },
  version: "1.0.2",
  author: { name: "光影 AI", url: "https://guangying.store/" },
  models: UPSTREAM_MODELS.slice(),
  fetchMode: "per_task",
  allowedHosts: ["guangying.store", "www.guangying.store", "api.guangying.store"],
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
  },
  usageExamples: [
    { label: "竖屏 · 5秒", facts: { seconds: 5 } },
    { label: "竖屏 · 15秒", facts: { seconds: 15 } },
  ],
  protocols: [{ name: "openai_video", models: UPSTREAM_MODELS.slice() }],
  routes: [
    {
      method: "POST",
      path: "/guangying/v1/video/generations",
      type: "submit",
      action: "video",
      decode: "decodeVideoSubmit",
      render: "taskCreated",
      models: UPSTREAM_MODELS.slice(),
    },
    {
      method: "GET",
      path: "/guangying/v1/tasks/:task_id",
      type: "query",
      render: "taskStatus",
      taskIdParam: "task_id",
    },
  ],
};

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function trimmed(value) {
  return String(value || "").trim();
}

function invalidRequest(message) {
  const err = new Error(message);
  err.code = "plugin_request_invalid";
  return err;
}

function clip(value) {
  const text = String(value || "").replace(/[\r\n\x00]+/g, " ").trim();
  if (text.length <= 500) return text;
  return text.slice(0, 500);
}

function assertVendor(ctx) {
  const kind = ctx && ctx.upstream && ctx.upstream.kind;
  if (kind && kind !== "vendor") {
    throw invalidRequest("guangying 只支持直连光影站点，不支持把 New API 渠道当作上游");
  }
}

function channelBase(ctx) {
  let base = trimmed(ctx && ctx.baseUrl).replace(/\/+$/, "");
  if (/\/v1$/i.test(base)) base = base.slice(0, -3);
  if (!/^https?:\/\//i.test(base)) {
    throw invalidRequest("渠道 Base URL 必须是光影站点根地址，例如 https://api.guangying.store 或 https://guangying.store，不要自带 /v1");
  }
  return base;
}

function authorizationHeader(ctx) {
  const header = trimmed(ctx && ctx.authHeader);
  if (/^Bearer\s+\S/i.test(header)) return header;
  const key = trimmed(ctx && ctx.apiKey);
  if (!key) throw invalidRequest("渠道密钥未配置");
  if (/^Bearer\s+\S/i.test(key)) return key;
  return "Bearer " + key;
}

function idempotencyKey(ctx) {
  const id = trimmed(ctx && ctx.publicTaskId);
  if (!id || id.length > 200 || /[\r\n\x00]/.test(id)) {
    throw invalidRequest("缺少可用于 Idempotency-Key 的 publicTaskId");
  }
  return id;
}

function wireModel(ctx) {
  const upstream = trimmed(ctx && ctx.upstreamModel) || trimmed(ctx && ctx.model);
  if (UPSTREAM_MODELS.indexOf(upstream) < 0) {
    throw invalidRequest("unsupported model: " + (upstream || "(empty)"));
  }
  return upstream;
}

function metadataOf(req) {
  if (!req || req.metadata === undefined) return {};
  if (!object(req.metadata)) throw invalidRequest("metadata 必须是对象");
  return req.metadata;
}

function claimedModel(req, ctx) {
  if (!req || req.model === undefined || req.model === null || req.model === "") return;
  if (typeof req.model !== "string") throw invalidRequest("model 必须是字符串");
  const claimed = trimmed(req.model);
  if (!claimed) return;
  const pin = trimmed(ctx && ctx.model);
  const upstream = trimmed(ctx && ctx.upstreamModel);
  const wired = wireModel(ctx);
  // Accept facade (pin), wired upstream id, and host param_routing select /
  // internal names rewritten into body.model (e.g. sd2.0-满血-guangying).
  // Only reject a *different* declared upstream id than the wired one.
  if (claimed === pin || claimed === upstream || claimed === wired) return;
  if (UPSTREAM_MODELS.indexOf(claimed) >= 0) {
    throw invalidRequest("unsupported model: " + claimed);
  }
}

function readPositiveTexts(label, values) {
  const found = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") throw invalidRequest(label + " 必须是字符串");
    const text = value.trim();
    if (!text) continue;
    found.push(text);
  }
  return found;
}

function sameToken(left, right) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function outboundRatio(model, req) {
  const metadata = metadataOf(req);
  const found = readPositiveTexts("ratio", [
    req.ratio,
    req.aspect_ratio,
    req.aspect,
    metadata.ratio,
    metadata.aspect_ratio,
  ]);
  const rules = MODEL_RULES[model];
  if (rules.ratioMode === "9:16") {
    if (!found.length) return "9:16";
    for (let i = 0; i < found.length; i++) {
      if (found[i] !== "9:16") {
        throw invalidRequest("gy-model-13（竖屏-Seedance 2.0）只接受比例 9:16，收到 " + found[i]);
      }
    }
    return "9:16";
  }
  if (!found.length) return "AUTO";
  for (let i = 1; i < found.length; i++) {
    if (!sameToken(found[i], found[0]) && !autoPortraitAlias(found[i], found[0])) {
      throw invalidRequest("ratio 与 aspect_ratio 冲突");
    }
  }
  const token = found[0];
  const lower = token.toLowerCase();
  if (token === "AUTO" || lower === "auto" || token === "9:16" || lower === "portrait") return "AUTO";
  throw invalidRequest(model + "（" + rules.name + "）只接受比例 AUTO。横屏或其他比例 " + token + " 被拒绝，不会改写成 9:16 发给上游");
}

function autoPortraitAlias(left, right) {
  const portrait = { auto: true, "9:16": true, portrait: true };
  return portrait[left.trim().toLowerCase()] && portrait[right.trim().toLowerCase()];
}

function outboundResolution(req) {
  const metadata = metadataOf(req);
  const found = readPositiveTexts("resolution", [
    req.resolution,
    req.video_resolution,
    metadata.resolution,
    metadata.video_resolution,
  ]);
  if (req.size !== undefined && req.size !== null && req.size !== "") {
    if (typeof req.size !== "string") throw invalidRequest("size 必须是字符串");
    const size = req.size.trim();
    if (size) found.push(size);
  }
  if (metadata.size !== undefined && metadata.size !== null && metadata.size !== "") {
    if (typeof metadata.size !== "string") throw invalidRequest("size 必须是字符串");
    const size = metadata.size.trim();
    if (size) found.push(size);
  }
  if (!found.length) return "720p";
  for (let i = 0; i < found.length; i++) {
    if (found[i].toLowerCase() !== "720p") {
      throw invalidRequest("竖屏白名单模型只接受分辨率 720p，收到 " + found[i]);
    }
  }
  return "720p";
}

function outboundDuration(model, req) {
  const rules = MODEL_RULES[model];
  const metadata = metadataOf(req);
  const hasDuration = req.duration !== undefined && req.duration !== null && req.duration !== "";
  const hasSeconds = req.seconds !== undefined && req.seconds !== null && req.seconds !== "";
  const metaDuration = metadata.duration !== undefined && metadata.duration !== null && metadata.duration !== "";
  const metaSeconds = metadata.seconds !== undefined && metadata.seconds !== null && metadata.seconds !== "";
  const raw = hasDuration ? req.duration : hasSeconds ? req.seconds : metaDuration ? metadata.duration : metaSeconds ? metadata.seconds : undefined;
  if (raw === undefined) {
    throw invalidRequest(model + "（" + rules.name + "）必须提供整数时长 " + rules.minDuration + "–" + rules.maxDuration + " 秒");
  }
  const primary = integerSeconds(raw, model, rules);
  const checks = [];
  if (hasDuration) checks.push(req.duration);
  if (hasSeconds) checks.push(req.seconds);
  if (metaDuration) checks.push(metadata.duration);
  if (metaSeconds) checks.push(metadata.seconds);
  for (let i = 0; i < checks.length; i++) {
    if (integerSeconds(checks[i], model, rules) !== primary) {
      throw invalidRequest("duration 与 seconds 冲突");
    }
  }
  return primary;
}

function integerSeconds(value, model, rules) {
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    throw invalidRequest(model + " 的时长必须是整数秒（" + rules.minDuration + "–" + rules.maxDuration + "）");
  }
  if (typeof value !== "number" && typeof value !== "string") {
    throw invalidRequest(model + " 的时长必须是整数秒（" + rules.minDuration + "–" + rules.maxDuration + "）");
  }
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isInteger(n) || n < rules.minDuration || n > rules.maxDuration) {
    throw invalidRequest(model + "（" + rules.name + "）时长必须是 " + rules.minDuration + "–" + rules.maxDuration + " 的整数秒");
  }
  return n;
}

function promptOf(req) {
  if (!req || typeof req.prompt !== "string" || !req.prompt.trim()) {
    throw invalidRequest("prompt 不能为空");
  }
  return req.prompt;
}

function nativeFaceOf(req) {
  const metadata = metadataOf(req);
  const value = req.nativeFace !== undefined ? req.nativeFace : metadata.nativeFace;
  if (value === undefined || value === false) return false;
  if (value === true) throw invalidRequest("这些竖屏模型不支持 nativeFace");
  throw invalidRequest("nativeFace 必须是布尔值");
}

const URL_REJECTED =
  "plugin_request_invalid：参考素材只接受光影上传接口返回的 fileId（POST /v1/media/uploads 的 data.id），不能提交图片、视频或音频 URL。本插件不会代为上传。";

function isUrlLike(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return true;
  if (text.indexOf("://") >= 0) return true;
  if (text.indexOf("/") >= 0) return true;
  return false;
}

function readFileId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!id || id.length > 256) return "";
  if (/[\s\x00-\x1f]/.test(id)) return "";
  if (isUrlLike(id)) return "";
  return id;
}

function rejectUrlMedia() {
  throw invalidRequest(URL_REJECTED);
}

function assetType(value, fallback) {
  const raw = object(value) ? trimmed(value.type).toLowerCase() : "";
  const type = raw || fallback;
  if (type !== "image" && type !== "video" && type !== "audio") {
    throw invalidRequest("assets.type 必须是 image、video 或 audio");
  }
  return type;
}

function assetName(value) {
  if (!object(value) || value.name === undefined || value.name === null || value.name === "") return "";
  if (typeof value.name !== "string") throw invalidRequest("素材 name 必须是字符串");
  const name = value.name.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
    throw invalidRequest("素材 name 需以字母开头，仅含字母、数字、下划线或连字符，例如 image1");
  }
  return name;
}

function collectCandidates(req) {
  const metadata = metadataOf(req);
  const out = [];
  const push = function (value, fallback) {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) push(value[i], fallback);
      return;
    }
    out.push({ value: value, fallback: fallback });
  };
  push(req.assets, "");
  push(metadata.assets, "");
  push(req.images, "image");
  push(req.image_urls, "image");
  push(req.image_url, "image");
  push(req.image, "image");
  push(req.input_reference, "image");
  push(req.reference_images, "image");
  push(metadata.images, "image");
  push(metadata.image_urls, "image");
  push(metadata.image, "image");
  push(metadata.input_reference, "image");
  push(req.videos, "video");
  push(req.video_urls, "video");
  push(req.video_url, "video");
  push(req.video, "video");
  push(req.reference_videos, "video");
  push(metadata.videos, "video");
  push(req.audios, "audio");
  push(req.audio_urls, "audio");
  push(req.audio_url, "audio");
  push(req.audio, "audio");
  push(req.reference_audios, "audio");
  push(metadata.audios, "audio");
  return out;
}

function explicitFileId(value, key) {
  if (!object(value) || value[key] === undefined || value[key] === null || value[key] === "") return "";
  if (typeof value[key] !== "string") throw invalidRequest("fileId 必须是字符串");
  const id = readFileId(value[key]);
  if (!id) rejectUrlMedia();
  return id;
}

function fileIdFromObject(value) {
  if (!object(value)) return "";
  if (value.__fileRef || value.fileRef || value.ref) {
    throw invalidRequest("plugin_request_invalid：本插件不能接收上传文件或 file ref。请先在光影完成上传，再提交 fileId。");
  }
  const direct = explicitFileId(value, "fileId") || explicitFileId(value, "file_id");
  if (direct) return direct;
  const urlFields = ["url", "uri", "image_url", "video_url", "audio_url", "imageUrl", "videoUrl", "audioUrl"];
  for (let i = 0; i < urlFields.length; i++) {
    const field = value[urlFields[i]];
    if (typeof field === "string" && field.trim()) rejectUrlMedia();
    if (object(field)) {
      const nested = explicitFileId(field, "fileId") || explicitFileId(field, "file_id");
      if (nested) return nested;
      if (typeof field.url === "string" && field.url.trim()) rejectUrlMedia();
    }
  }
  return "";
}

function oneAsset(entry) {
  const value = entry.value;
  if (typeof value === "string") {
    if (isUrlLike(value) || /^data:/i.test(value.trim())) rejectUrlMedia();
    const fileId = readFileId(value);
    if (!fileId) rejectUrlMedia();
    if (!entry.fallback) throw invalidRequest("assets.type 必须是 image、video 或 audio");
    return { type: entry.fallback, fileId: fileId, name: "" };
  }
  if (!object(value)) throw invalidRequest("参考素材必须是带 fileId 的对象");
  const fileId = fileIdFromObject(value);
  if (!fileId) {
    rejectUrlMedia();
  }
  return { type: assetType(value, entry.fallback), fileId: fileId, name: assetName(value) };
}

function mapAssets(model, req) {
  const rules = MODEL_RULES[model];
  const candidates = collectCandidates(req);
  const assets = [];
  const seenId = {};
  const seenName = {};
  const counts = { image: 0, video: 0, audio: 0 };
  for (let i = 0; i < candidates.length; i++) {
    const item = oneAsset(candidates[i]);
    if (seenId[item.fileId]) throw invalidRequest("fileId 重复：" + item.fileId);
    seenId[item.fileId] = true;
    let name = item.name;
    if (name) {
      if (seenName[name]) throw invalidRequest("素材 name 重复：" + name);
    } else {
      let n = counts[item.type];
      do {
        n += 1;
        name = item.type + String(n);
      } while (seenName[name]);
    }
    seenName[name] = true;
    counts[item.type] += 1;
    assets.push({ type: item.type, fileId: item.fileId, name: name });
  }
  if (counts.image > rules.maxImages) {
    throw invalidRequest(rules.name + " 最多 " + rules.maxImages + " 张参考图");
  }
  if (counts.video > rules.maxVideos) {
    throw invalidRequest(rules.name + (rules.maxVideos === 0 ? " 不接受参考视频" : " 最多 " + rules.maxVideos + " 段参考视频"));
  }
  if (counts.audio > rules.maxAudios) {
    throw invalidRequest(rules.name + (rules.maxAudios === 0 ? " 不接受参考音频" : " 最多 " + rules.maxAudios + " 段参考音频"));
  }
  if (assets.length > rules.maxReferences) {
    throw invalidRequest(rules.name + " 参考素材总数不能超过 " + rules.maxReferences);
  }
  if (counts.image < rules.minImages) {
    throw invalidRequest(rules.name + " 至少需要 " + rules.minImages + " 个图片 fileId");
  }
  if (!rules.textToVideo && assets.length === 0) {
    throw invalidRequest(rules.name + " 不支持纯文生视频，至少需要 1 个图片 fileId");
  }
  if (rules.textToVideo && assets.length > 0 && counts.image + counts.video < 1) {
    throw invalidRequest(rules.name + " 有参考素材时至少需要 1 个图片或视频 fileId");
  }
  return assets;
}

function buildUpstreamBody(ctx) {
  assertVendor(ctx);
  if ((ctx.files || []).length) {
    throw invalidRequest("plugin_request_invalid：不接受 multipart 文件。请先上传到光影并提交 fileId，本插件不会代为上传。");
  }
  const req = object(ctx.requestBody) ? ctx.requestBody : null;
  if (!req) throw invalidRequest("JSON object required");
  const model = wireModel(ctx);
  claimedModel(req, ctx);
  const assets = mapAssets(model, req);
  nativeFaceOf(req);
  return {
    model: model,
    prompt: promptOf(req),
    duration: outboundDuration(model, req),
    ratio: outboundRatio(model, req),
    resolution: outboundResolution(req),
    assets: assets,
    nativeFace: false,
  };
}

function actionOf(req) {
  const body = object(req) ? req : {};
  const videoKeys = ["videos", "video_urls", "video_url", "video", "reference_videos", "audios", "audio_urls", "audio_url", "audio", "reference_audios"];
  for (let i = 0; i < videoKeys.length; i++) {
    if (body[videoKeys[i]] !== undefined && body[videoKeys[i]] !== null && body[videoKeys[i]] !== "") return "reference_to_video";
  }
  const imageKeys = ["images", "image_urls", "image_url", "image", "input_reference", "reference_images", "assets"];
  for (let i = 0; i < imageKeys.length; i++) {
    const value = body[imageKeys[i]];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    return "image_to_video";
  }
  return "text_to_video";
}

function payloadOf(body) {
  if (!object(body)) return {};
  if (object(body.data)) return body.data;
  return body;
}

function errorText(error) {
  if (typeof error === "string") return clip(error);
  if (!object(error)) return "";
  return clip(error.message || error.code || "");
}

function assertTaskId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}$/.test(value)) {
    throw new Error("video task id is missing or invalid");
  }
  return value;
}

function httpsUrl(value) {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (!/^https:\/\/[^\s]+$/.test(url)) return "";
  return url;
}

function resultUrl(data) {
  const direct = httpsUrl(data && data.downloadUrl);
  if (direct) return direct;
  const results = data && Array.isArray(data.results) ? data.results : [];
  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    if (!object(item)) continue;
    if (trimmed(item.type).toLowerCase() === "video") {
      const url = httpsUrl(item.url);
      if (url) return url;
    }
  }
  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    if (!object(item)) continue;
    const url = httpsUrl(item.url);
    if (url) return url;
  }
  return "";
}

function rawProgress(data) {
  const mode = trimmed(data && data.progressMode).toUpperCase();
  const missing = !data || data.progress === undefined || data.progress === null || data.progress === "";
  if (mode === "ESTIMATED" && data && data.estimatedProgress !== undefined && data.estimatedProgress !== null && data.estimatedProgress !== "") {
    return data.estimatedProgress;
  }
  if (!missing) return data.progress;
  if (data && data.estimatedProgress !== undefined && data.estimatedProgress !== null && data.estimatedProgress !== "") {
    return data.estimatedProgress;
  }
  return undefined;
}

// Guangying documents progress as a 0–100 integer. A 0–1 fraction is scaled
// only when it is strictly between 0 and 1 and the raw text has no percent sign.
// The value 1 is 1% on that scale. Multiplying it by 100 stored a fake 100%
// while status was still IN_PROGRESS (dafeiyang). Non-terminal results never
// store 100%.
function progressText(raw, status) {
  if (status === "SUCCESS") return "100%";
  if (status === "QUEUED" || status === "SUBMITTED" || status === "NOT_START") return "0%";
  if (status !== "IN_PROGRESS") return undefined;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const text = String(raw).trim();
  if (!text) return undefined;
  const hasPercent = text.indexOf("%") >= 0;
  const numericText = hasPercent ? text.replace(/%/g, "").trim() : text;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(numericText)) return undefined;
  const n = Number(numericText);
  if (!Number.isFinite(n)) return undefined;
  let pct = n;
  if (!hasPercent && n > 0 && n < 1) pct = n * 100;
  if (!Number.isFinite(pct)) return undefined;
  pct = Math.floor(pct);
  if (pct < 0) return undefined;
  if (pct >= 100) pct = 99;
  return String(pct) + "%";
}

const STATUS_MAP = {
  queued: "QUEUED",
  pending: "QUEUED",
  processing: "IN_PROGRESS",
  in_progress: "IN_PROGRESS",
  running: "IN_PROGRESS",
  succeeded: "SUCCESS",
  success: "SUCCESS",
  completed: "SUCCESS",
  failed: "FAILURE",
  failure: "FAILURE",
  error: "FAILURE",
  cancelled: "FAILURE",
  canceled: "FAILURE",
  requires_attention: "FAILURE",
};

function mapStatus(raw) {
  const key = trimmed(raw).toLowerCase();
  if (!key) return { status: "UNKNOWN", reason: "missing task status" };
  const status = STATUS_MAP[key];
  if (!status) return { status: "UNKNOWN", reason: "unrecognized status: " + clip(raw) };
  return { status: status, upstream: key };
}

export function buildSubmitRequest(ctx) {
  const body = buildUpstreamBody(ctx);
  return {
    url: channelBase(ctx) + "/v1/video/generations",
    method: "POST",
    headers: {
      Authorization: authorizationHeader(ctx),
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": idempotencyKey(ctx),
    },
    body: body,
  };
}

export function parseSubmitResponse(_ctx, response) {
  const body = response && response.body;
  const data = payloadOf(body);
  if (object(body) && body.error && !data.id && !data.task_id) {
    throw new Error(errorText(body.error) || "submit failed");
  }
  if (data.error && !data.id && !data.task_id) {
    throw new Error(errorText(data.error) || "submit failed");
  }
  const taskId = assertTaskId(typeof data.id === "string" && data.id ? data.id : data.task_id);
  return { taskId: taskId, taskData: data };
}

export function buildQueryRequest(ctx) {
  assertVendor(ctx);
  const taskId = assertTaskId(ctx && ctx.taskId);
  return {
    url: channelBase(ctx) + "/v1/tasks/" + encodeURIComponent(taskId),
    method: "GET",
    headers: {
      Authorization: authorizationHeader(ctx),
      Accept: "application/json",
    },
  };
}

export function parseTaskResult(_ctx, body) {
  const root = object(body) ? body : {};
  const data = payloadOf(root);
  const statusValue = data.status !== undefined ? data.status : root.status;
  if ((statusValue === undefined || statusValue === null || statusValue === "") && (root.error || data.error)) {
    const message = errorText(data.error || root.error) || "upstream error";
    return { status: "UNKNOWN", reason: message };
  }
  const mapped = mapStatus(statusValue);
  if (mapped.status === "UNKNOWN") return { status: "UNKNOWN", reason: mapped.reason };
  const result = { status: mapped.status };
  const progress = progressText(rawProgress(data), mapped.status);
  if (progress !== undefined) result.progress = progress;
  if (mapped.status === "FAILURE") {
    if (mapped.upstream === "requires_attention") {
      const extra = errorText(data.error || root.error);
      result.reason = extra ? REQUIRES_ATTENTION_REASON + " " + extra : REQUIRES_ATTENTION_REASON;
    } else {
      result.reason = errorText(data.error || root.error) || trimmed(data.fail_reason) || "task failed";
    }
  }
  if (mapped.status === "SUCCESS") {
    const url = resultUrl(data);
    if (url) {
      result.url = url;
      result.remoteUrl = url;
    }
  }
  return result;
}

export function extractUsage(ctx) {
  const body = buildUpstreamBody(ctx);
  return { seconds: body.duration };
}

export function extractUsageOnComplete(_task, _result, body) {
  const data = payloadOf(body);
  const raw = data.duration !== undefined && data.duration !== null && data.duration !== "" ? data.duration : data.seconds;
  if (typeof raw === "string" && !/^\d+$/.test(raw.trim())) return {};
  if (typeof raw !== "number" && typeof raw !== "string") return {};
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (!Number.isInteger(n) || n <= 0 || n > 3600) return {};
  return { seconds: n };
}

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  if (!resultUrl(payloadOf(task.data))) return [];
  return [{ key: "video", type: "video", mimeType: "video/mp4" }];
}

export function buildContentRequest(ctx) {
  if (!ctx || ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const method = String((ctx.clientRequest && ctx.clientRequest.method) || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new Error("Video content supports GET and HEAD only");
  const url = resultUrl(payloadOf(ctx.data));
  if (!url) throw new Error("artifact_not_found");
  const headers = {};
  const incoming = (ctx.clientRequest && ctx.clientRequest.headers) || {};
  const allowed = { range: "Range", "if-range": "If-Range", "if-none-match": "If-None-Match", "if-modified-since": "If-Modified-Since" };
  const names = Object.keys(incoming);
  for (let i = 0; i < names.length; i++) {
    const target = allowed[names[i].toLowerCase()];
    if (target && typeof incoming[names[i]] === "string") headers[target] = incoming[names[i]];
  }
  return {
    url: url,
    method: method,
    headers: headers,
    credentialless: true,
  };
}

function taskCreated(_ctx, task) {
  return {
    id: task.task_id,
    task_id: task.task_id,
    object: "video_job",
    status: "queued",
    model: (task.properties && task.properties.origin_model_name) || "",
  };
}

function taskStatus(_ctx, task) {
  const statusMap = {
    NOT_START: "queued",
    SUBMITTED: "queued",
    QUEUED: "queued",
    IN_PROGRESS: "processing",
    SUCCESS: "succeeded",
    FAILURE: "failed",
  };
  const output = {
    id: task.task_id,
    task_id: task.task_id,
    object: "video_job",
    status: statusMap[task.status] || "unknown",
    progress: String(task.progress || "0%"),
    model: (task.properties && task.properties.origin_model_name) || "",
  };
  if (task.status === "FAILURE") output.fail_reason = task.fail_reason || "";
  return output;
}

function decodeVideoSubmit(ctx) {
  if (!ctx.body || ctx.body.kind !== "json") {
    throw invalidRequest("plugin_request_invalid：请使用 JSON。本插件不接受 multipart 上传，参考素材请传光影 fileId。");
  }
  const body = ctx.body.value;
  if (!object(body)) throw invalidRequest("JSON object required");
  const model = trimmed(body.model);
  if (!model) throw invalidRequest("model is required");
  if (UPSTREAM_MODELS.indexOf(model) < 0) throw invalidRequest("unsupported model: " + model);
  if (typeof body.prompt !== "string" || !body.prompt.trim()) throw invalidRequest("prompt 不能为空");
  return { kind: "submit", model: model, action: "video", requestBody: body };
}

export const native = {
  decodeVideoSubmit: decodeVideoSubmit,
  taskCreated: taskCreated,
  taskStatus: taskStatus,
  error: function (_ctx, error) {
    return {
      error: {
        code: (error && error.code) || "plugin_request_invalid",
        message: (error && error.message) || "request failed",
      },
    };
  },
};

const VIDEO_STATUS = {
  NOT_START: "queued",
  SUBMITTED: "queued",
  QUEUED: "queued",
  IN_PROGRESS: "in_progress",
  SUCCESS: "completed",
  FAILURE: "failed",
};

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") {
        throw invalidRequest("plugin_request_invalid：请使用 JSON /v1/videos。本插件不接受 multipart 上传，参考素材请传光影 fileId。");
      }
      if (!object(ctx.body.value)) throw invalidRequest("JSON object required");
      if (!trimmed(ctx.model)) throw invalidRequest("model is required");
      return {
        kind: "submit",
        model: ctx.model,
        action: actionOf(ctx.body.value),
        requestBody: ctx.body.value,
      };
    },
    render: function (_ctx, task) {
      const data = object(task.data) ? task.data : {};
      const output = {
        id: task.task_id,
        object: "video",
        model: (task.properties && task.properties.origin_model_name) || "",
        status: VIDEO_STATUS[task.status] || "unknown",
        created_at: Number(task.created_at || 0),
      };
      const progress = Number(String(task.progress === undefined || task.progress === null ? "" : task.progress).replace(/%/g, ""));
      if (task.status === "SUCCESS") output.progress = 100;
      else if (Number.isFinite(progress)) output.progress = progress >= 100 ? 99 : progress < 0 ? 0 : progress;
      const finished = Number(task.finished_at || 0);
      if ((task.status === "SUCCESS" || task.status === "FAILURE") && finished > 0) output.completed_at = finished;
      if (task.status === "FAILURE") {
        output.error = {
          code: "video_generation_failed",
          message: task.fail_reason || "task failed",
        };
      }
      if (data.provider_status) output.provider_status = data.provider_status;
      return output;
    },
  },
};


