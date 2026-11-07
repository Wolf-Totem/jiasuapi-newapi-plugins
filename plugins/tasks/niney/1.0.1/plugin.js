/**
 * 9Y API (niney) — NewAPI Task Plugin API v1.
 *
 * Relays host-owned openai_video calls to 9Y's OpenAI-compatible video API
 * for one model, DB-SD-2.5 (https://9yapi.shop/docs/#model-b3224fda9acd):
 *   POST /v1/videos
 *   GET  /v1/videos/{task_id}
 *   GET|HEAD /v1/videos/{task_id}/content
 *
 * The channel base is the site origin (https://9yapi.shop). This file appends
 * /v1/.... A base that already ends in /v1 is accepted once so the request is
 * not sent to /v1/v1/videos.
 *
 * DB-SD-2.5 is fixed at 30 seconds and 720p. Outbound seconds is always 30,
 * including when the client sent another duration, and extractUsage reports
 * 30 so billing matches the only video this model generates. Reference images
 * must already be public HTTPS URLs (or a reference_path URL the caller
 * uploaded with their own key). This plugin does not upload.
 *
 * Bind a Task Plugin channel with task_plugin_key niney.
 * Legacy channel type numbers are intentionally absent. No API key is embedded.
 */
const MODEL = "DB-SD-2.5";
const SECONDS = 30;
const RESOLUTION = "720p";
const MAX_PROMPT_CHARS = 3000;
const MAX_REFERENCE_IMAGES = 10;
const ASPECTS = { "16:9": true, "9:16": true, "1:1": true, "4:3": true, "3:4": true, "21:9": true };
// Pixel sizes are reduced by gcd. 21:9 reduces to 7:3 (1680x720 and the like).
const ASPECT_BY_REDUCED = { "16:9": "16:9", "9:16": "9:16", "1:1": "1:1", "4:3": "4:3", "3:4": "3:4", "7:3": "21:9" };
const ASPECT_ERROR = "aspect_ratio must be 16:9, 9:16, 1:1, 4:3, 3:4, or 21:9";
const RESOLUTION_ERROR = "DB-SD-2.5 only accepts resolution 720p";
const JSON_ONLY = "DB-SD-2.5 accepts a JSON object (Content-Type: application/json). This plugin does not upload files; pass public HTTPS image URLs.";
const IMAGE_KEYS = ["reference_images", "images", "image_urls", "image_url", "image", "input_reference"];
const VIDEO_KEYS = ["reference_videos", "reference_video", "videos", "video", "video_url", "video_urls", "referenceVideos"];
const AUDIO_KEYS = ["reference_audios", "reference_audio", "audios", "audio", "audio_url", "audio_urls", "referenceAudios"];
const FRAME_KEYS = ["first_frame", "last_frame", "end_frame", "start_frame", "first_frame_url", "last_frame_url", "end_frame_url", "start_frame_url"];
const FRAME_ROLES = {
  first_frame: true,
  last_frame: true,
  end_frame: true,
  start_frame: true,
  firstframe: true,
  lastframe: true,
  endframe: true,
  startframe: true,
};
const REQUEST_FIELDS = [
  "model", "prompt", "seconds", "duration", "resolution", "video_resolution", "size",
  "aspect_ratio", "ratio", "aspect", "reference_images", "images", "image_urls",
  "image_url", "image", "input_reference", "metadata",
].concat(VIDEO_KEYS, AUDIO_KEYS, FRAME_KEYS);
const METADATA_FIELDS = [
  "seconds", "duration", "resolution", "video_resolution", "size",
  "aspect_ratio", "ratio", "aspect", "reference_images", "images", "image_urls",
  "image_url", "image", "input_reference",
].concat(VIDEO_KEYS, AUDIO_KEYS, FRAME_KEYS);

export const meta = {
  apiVersion: 1,
  key: "niney",
  name: "9Y API",
  icon: "text:9Y",
  description: {
    en: "9Y API video for DB-SD-2.5 only. Fixed 30s 720p; aspect ratio and up to 10 public HTTPS reference images. Channel base is the site origin, for example https://9yapi.shop",
    zh: "通过 9Y API（9yapi.shop）生成视频，仅白名单模型 DB-SD-2.5。固定 30 秒 720p，可选画幅和最多 10 张公开 HTTPS 参考图。渠道 Base URL 填站点根地址，例如 https://9yapi.shop",
  },
  version: "1.0.1",
  author: { name: "9Y API", url: "https://9yapi.shop" },
  models: [MODEL],
  fetchMode: "per_task",
  allowedHosts: ["9yapi.shop", "www.9yapi.shop"],
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video duration in seconds. DB-SD-2.5 is always 30.", zh: "视频时长，单位秒。DB-SD-2.5 固定为 30。" },
    },
  },
  usageExamples: [{ label: "DB-SD-2.5 · 30秒 · 720p", facts: { seconds: SECONDS } }],
  protocols: [{ name: "openai_video", models: [MODEL] }],
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

function onlyFields(value, allowed, label) {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    if (allowed.indexOf(keys[i]) < 0) throw invalidRequest(label + ": unsupported field " + keys[i]);
  }
}

function hasMedia(value) {
  if (value === undefined || value === null || value === "" || value === false) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function rejectKeyedMedia(source) {
  if (!object(source)) return;
  for (let i = 0; i < VIDEO_KEYS.length; i++) {
    if (hasMedia(source[VIDEO_KEYS[i]])) {
      throw invalidRequest("DB-SD-2.5 does not accept reference videos (" + VIDEO_KEYS[i] + ")");
    }
  }
  for (let i = 0; i < AUDIO_KEYS.length; i++) {
    if (hasMedia(source[AUDIO_KEYS[i]])) {
      throw invalidRequest("DB-SD-2.5 does not accept reference audios (" + AUDIO_KEYS[i] + ")");
    }
  }
  for (let i = 0; i < FRAME_KEYS.length; i++) {
    if (hasMedia(source[FRAME_KEYS[i]])) {
      throw invalidRequest("DB-SD-2.5 does not accept first or last frames (" + FRAME_KEYS[i] + ")");
    }
  }
}

function charLength(text) {
  return Array.from(text).length;
}

function upstreamOrigin(baseUrl) {
  let base = trimmed(baseUrl).replace(/\/+$/, "");
  if (/\/v1$/i.test(base)) base = base.slice(0, -3);
  if (!/^https?:\/\//i.test(base)) throw invalidRequest("base URL is required");
  return base;
}

function authorizationHeader(ctx) {
  const header = trimmed(ctx && ctx.authHeader);
  if (/^Bearer\s+\S/i.test(header)) return header;
  const key = trimmed(ctx && ctx.apiKey);
  if (!key) throw invalidRequest("api key is required");
  if (/^Bearer\s+\S/i.test(key)) return key;
  return "Bearer " + key;
}

function wireModel(ctx, req) {
  const pin = trimmed(ctx && ctx.model);
  const upstream = trimmed(ctx && ctx.upstreamModel);
  const wired = upstream || pin;
  if (wired !== MODEL) {
    throw invalidRequest("unsupported model: " + (wired || "(empty)") + "; niney only relays DB-SD-2.5");
  }
  if (req && req.model !== undefined && req.model !== null && req.model !== "") {
    if (typeof req.model !== "string") throw invalidRequest("model must be a string");
    const claimed = trimmed(req.model);
    if (claimed && claimed !== pin && claimed !== upstream && claimed !== MODEL) {
      throw invalidRequest("unsupported model: " + claimed + "; niney only relays DB-SD-2.5");
    }
  }
  return MODEL;
}

function promptOf(req) {
  if (!req || typeof req.prompt !== "string" || !req.prompt.trim()) throw invalidRequest("prompt is required");
  if (charLength(req.prompt) > MAX_PROMPT_CHARS) throw invalidRequest("prompt must be at most 3000 characters");
  return req.prompt;
}

function metadataOf(req) {
  if (!req || req.metadata === undefined || req.metadata === null) return {};
  if (!object(req.metadata)) throw invalidRequest("metadata must be an object");
  rejectKeyedMedia(req.metadata);
  onlyFields(req.metadata, METADATA_FIELDS, "metadata");
  return req.metadata;
}

function assertResolution(value) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || value.trim().toLowerCase() !== "720p") throw invalidRequest(RESOLUTION_ERROR);
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function aspectFromSize(value) {
  if (typeof value !== "string") throw invalidRequest("size must be a string");
  const text = value.trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower === "720p") return "";
  if (lower === "480p" || lower === "1080p" || lower === "2160p" || lower === "4k") throw invalidRequest(RESOLUTION_ERROR);
  if (ASPECTS[text]) return text;
  const match = /^(\d+)\s*[xX]\s*(\d+)$/.exec(text);
  if (!match) throw invalidRequest("size " + text + " does not match a supported aspect ratio (16:9, 9:16, 1:1, 4:3, 3:4, 21:9)");
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    throw invalidRequest("size " + text + " does not match a supported aspect ratio (16:9, 9:16, 1:1, 4:3, 3:4, 21:9)");
  }
  const divisor = gcd(width, height);
  const aspect = ASPECT_BY_REDUCED[String(width / divisor) + ":" + String(height / divisor)];
  if (!aspect) throw invalidRequest("size " + text + " does not match a supported aspect ratio (16:9, 9:16, 1:1, 4:3, 3:4, 21:9)");
  return aspect;
}

function resolveAspect(req, metadata) {
  const explicit = [];
  const sources = [req, metadata];
  const names = ["aspect_ratio", "ratio", "aspect"];
  for (let s = 0; s < sources.length; s++) {
    const source = sources[s];
    if (!object(source)) continue;
    for (let n = 0; n < names.length; n++) {
      const value = source[names[n]];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "string") throw invalidRequest("aspect_ratio must be a string");
      const text = value.trim();
      if (!text) continue;
      if (!ASPECTS[text]) throw invalidRequest(ASPECT_ERROR);
      explicit.push(text);
    }
  }
  const fromSize = [];
  for (let s = 0; s < sources.length; s++) {
    const source = sources[s];
    if (!object(source) || source.size === undefined || source.size === null || source.size === "") continue;
    const derived = aspectFromSize(source.size);
    if (derived) fromSize.push(derived);
  }
  const chosen = explicit.length ? explicit[0] : fromSize.length ? fromSize[0] : "16:9";
  for (let i = 1; i < explicit.length; i++) {
    if (explicit[i] !== chosen) throw invalidRequest("aspect_ratio conflicts with ratio or aspect");
  }
  for (let i = 0; i < fromSize.length; i++) {
    if (fromSize[i] !== chosen) throw invalidRequest("aspect_ratio conflicts with size");
  }
  return chosen;
}

function assertResolutions(req, metadata) {
  const sources = [req, metadata];
  const names = ["resolution", "video_resolution"];
  for (let s = 0; s < sources.length; s++) {
    const source = sources[s];
    if (!object(source)) continue;
    for (let n = 0; n < names.length; n++) assertResolution(source[names[n]]);
  }
}

function pushImages(value, out) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) pushImages(value[i], out);
    return;
  }
  out.push(value);
}

function frameRole(value) {
  if (!object(value)) return "";
  const role = trimmed(value.type || value.role || value.image_type).toLowerCase().replace(/[\s-]+/g, "_");
  return role;
}

function imageUrlValue(value) {
  if (typeof value === "string") return value;
  if (!object(value)) throw invalidRequest("reference image must be a public HTTPS URL string or {url}");
  if (value.__fileRef || value.fileRef || value.file_ref) {
    throw invalidRequest(JSON_ONLY);
  }
  const role = frameRole(value);
  if (role && FRAME_ROLES[role]) throw invalidRequest("DB-SD-2.5 does not accept first or last frames");
  if (role === "video" || role === "audio" || role === "reference_video" || role === "reference_audio") {
    throw invalidRequest("DB-SD-2.5 does not accept reference videos or audios");
  }
  for (let i = 0; i < FRAME_KEYS.length; i++) {
    if (hasMedia(value[FRAME_KEYS[i]])) throw invalidRequest("DB-SD-2.5 does not accept first or last frames");
  }
  if (hasMedia(value.video_url) || hasMedia(value.videoUrl) || hasMedia(value.audio_url) || hasMedia(value.audioUrl)) {
    throw invalidRequest("DB-SD-2.5 does not accept reference videos or audios");
  }
  let url = value.url;
  if ((url === undefined || url === null || url === "") && value.image_url !== undefined) url = value.image_url;
  if (object(url)) {
    if (frameRole(url) && FRAME_ROLES[frameRole(url)]) throw invalidRequest("DB-SD-2.5 does not accept first or last frames");
    url = url.url;
  }
  if (typeof url !== "string") throw invalidRequest("reference image must be a public HTTPS URL string or {url}");
  return url;
}

function requireHttps(value) {
  if (typeof value !== "string") throw invalidRequest("reference image must be a public HTTPS URL");
  const text = value.trim();
  if (!text || /[\s\x00-\x1f]/.test(text) || text.length > 4096) {
    throw invalidRequest("reference image must be a public HTTPS URL");
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch (e) {
    throw invalidRequest("reference image must be a public HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) {
    throw invalidRequest("reference image must be a public HTTPS URL");
  }
  return text;
}

function referenceImages(req, metadata) {
  const raw = [];
  const sources = [req, metadata];
  for (let s = 0; s < sources.length; s++) {
    const source = sources[s];
    if (!object(source)) continue;
    for (let k = 0; k < IMAGE_KEYS.length; k++) pushImages(source[IMAGE_KEYS[k]], raw);
  }
  const images = [];
  const seen = {};
  for (let i = 0; i < raw.length; i++) {
    const url = requireHttps(imageUrlValue(raw[i]));
    if (seen[url]) continue;
    seen[url] = true;
    images.push(url);
  }
  if (images.length > MAX_REFERENCE_IMAGES) {
    throw invalidRequest("DB-SD-2.5 accepts at most 10 reference images");
  }
  return images;
}

function buildUpstreamBody(ctx) {
  if (ctx && Array.isArray(ctx.files) && ctx.files.length) throw invalidRequest(JSON_ONLY);

function absorbNineyHostMedia(req) {
  rejectKeyedMedia(req);
  if (object(req.metadata)) rejectKeyedMedia(req.metadata);
  const media = collectHostMedia(req);
  if (media.videos.length) throw invalidRequest("DB-SD-2.5 does not accept reference videos");
  if (media.audios.length) throw invalidRequest("DB-SD-2.5 does not accept reference audios");
  for (let i = 0; i < media.images.length; i++) {
    if (media.images[i].type) throw invalidRequest("DB-SD-2.5 does not accept first or last frames");
  }
  const images = [];
  const seen = {};
  const add = function (item) {
    const url = item && item.url ? hostMediaTrim(item.url) : "";
    if (!url) {
      if (item && (item.fileRef || item.fileId)) throw invalidRequest("reference image must be a public HTTPS URL");
      return;
    }
    if (seen[url]) return;
    seen[url] = true;
    images.push(url);
  };
  for (let i = 0; i < media.images.length; i++) add(media.images[i]);
  for (let i = 0; i < media.materials.length; i++) {
    const typ = media.materials[i].materialType || "";
    if (typ === "video" || typ === "reference_video") throw invalidRequest("DB-SD-2.5 does not accept reference videos");
    if (typ === "audio" || typ === "reference_audio" || typ === "reference_voice" || typ === "voice") throw invalidRequest("DB-SD-2.5 does not accept reference audios");
    if (hostMediaFrameType(typ)) throw invalidRequest("DB-SD-2.5 does not accept first or last frames");
    add(media.materials[i]);
  }
  const next = {};
  const keys = Object.keys(req);
  for (let i = 0; i < keys.length; i++) next[keys[i]] = req[keys[i]];
  if (images.length) next.images = images;
  else delete next.images;
  for (let i = 0; i < HOST_MEDIA_DROP_KEYS.length; i++) delete next[HOST_MEDIA_DROP_KEYS[i]];
  for (let i = 0; i < HOST_FIRST_FRAME_KEYS.length; i++) delete next[HOST_FIRST_FRAME_KEYS[i]];
  for (let i = 0; i < HOST_END_FRAME_KEYS.length; i++) delete next[HOST_END_FRAME_KEYS[i]];
  delete next.materials;
  if (object(next.metadata)) {
    const metadata = {};
    const metaKeys = Object.keys(next.metadata);
    for (let i = 0; i < metaKeys.length; i++) metadata[metaKeys[i]] = next.metadata[metaKeys[i]];
    for (let i = 0; i < HOST_MEDIA_DROP_KEYS.length; i++) delete metadata[HOST_MEDIA_DROP_KEYS[i]];
    for (let i = 0; i < HOST_FIRST_FRAME_KEYS.length; i++) delete metadata[HOST_FIRST_FRAME_KEYS[i]];
    for (let i = 0; i < HOST_END_FRAME_KEYS.length; i++) delete metadata[HOST_END_FRAME_KEYS[i]];
    delete metadata.images;
    delete metadata.videos;
    delete metadata.audios;
    delete metadata.materials;
    next.metadata = metadata;
  }
  return next;
}

  const raw = ctx && ctx.requestBody;
  if (!object(raw)) throw invalidRequest("JSON object required");
  const req = absorbNineyHostMedia(raw);
  onlyFields(req, REQUEST_FIELDS, "video request");
  const metadata = metadataOf(req);
  assertResolutions(req, metadata);
  // Client seconds/duration are intentionally not forwarded. This model cannot
  // generate another length, and a client value of 5 (or any other number)
  // must not change the billing fact, which is always 30.
  const body = {
    model: wireModel(ctx, req),
    prompt: promptOf(req),
    seconds: SECONDS,
    resolution: RESOLUTION,
    aspect_ratio: resolveAspect(req, metadata),
  };
  const images = referenceImages(req, metadata);
  if (images.length) body.reference_images = images;
  return body;
}

function actionOf(req) {
  const body = object(req) ? req : {};
  const metadata = object(body.metadata) ? body.metadata : {};
  const sources = [body, metadata];
  for (let s = 0; s < sources.length; s++) {
    for (let k = 0; k < IMAGE_KEYS.length; k++) {
      if (hasMedia(sources[s][IMAGE_KEYS[k]])) return "image_to_video";
    }
  }
  return "text_to_video";
}

function readTaskId(body) {
  const top = object(body) ? body : {};
  const nested = object(top.data) ? top.data : {};
  const raw = top.id || top.task_id || nested.id || nested.task_id || "";
  const id = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!id || id.length > 200 || /[\r\n\x00]/.test(id)) return "";
  return id;
}

function statusSource(body) {
  const top = object(body) ? body : {};
  if (top.status !== undefined && top.status !== null && top.status !== "") return top;
  if (object(top.data) && top.data.status !== undefined && top.data.status !== null && top.data.status !== "") return top.data;
  return top;
}

function errorText(error) {
  if (typeof error === "string") return clip(error);
  if (!object(error)) return "";
  return clip(error.message || error.msg || error.code || "");
}

function failureReason(source) {
  return errorText(source && source.error) || (typeof source.fail_reason === "string" ? clip(source.fail_reason) : "") || "task failed";
}

const STATUS_MAP = {
  queued: "QUEUED",
  pending: "QUEUED",
  in_progress: "IN_PROGRESS",
  processing: "IN_PROGRESS",
  completed: "SUCCESS",
  failed: "FAILURE",
  cancelled: "FAILURE",
  canceled: "FAILURE",
};

function progressText(raw, status) {
  if (status === "SUCCESS" || status === "FAILURE") return "100%";
  if (raw === undefined || raw === null || raw === "") return undefined;
  const original = String(raw).trim();
  if (!original) return undefined;
  const numeric = original.replace(/%/g, "").trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(numeric)) return undefined;
  const n = Number(numeric);
  if (!Number.isFinite(n)) return undefined;
  let pct = n;
  if (original.indexOf("%") < 0 && n > 0 && n < 1) pct = n * 100;
  pct = Math.round(pct);
  if (pct < 0) return undefined;
  if (pct >= 100) pct = 99;
  return String(pct) + "%";
}

function httpsMediaUrl(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || /[\s\x00-\x1f]/.test(text) || text.length > 4096) return "";
  let parsed;
  try {
    parsed = new URL(text);
  } catch (e) {
    return "";
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) return "";
  return text;
}

function expired(expiresAt) {
  if (expiresAt === undefined || expiresAt === null || expiresAt === "") return false;
  const n = typeof expiresAt === "string" && /^\d+$/.test(expiresAt.trim()) ? Number(expiresAt.trim()) : expiresAt;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return false;
  const seconds = n > 1e12 ? Math.floor(n / 1000) : n;
  // Leave the CDN URL a little early so a download does not start on a link
  // that expires mid-stream. The /content fallback still needs the channel key.
  return seconds * 1000 <= Date.now() + 30000;
}

function freshMediaUrl(source) {
  if (!object(source)) return "";
  const url = httpsMediaUrl(source.video_url) || httpsMediaUrl(source.result_url);
  if (!url || expired(source.expires_at)) return "";
  return url;
}

function resultMediaUrl(body) {
  const top = object(body) ? body : {};
  return freshMediaUrl(top) || freshMediaUrl(top.data);
}

/**
 * Host public media collector. Copied into each task plugin because the
 * plugin runtime rejects import/require. Keep this snippet identical to
 * plugins/collect_host_media.js (js-v-api) and
 * plugins/tasks/_shared/collect-host-media.js (market repo).
 *
 * Returns the host public shape only. It does not invent upstream field names.
 * images[].type is first_frame or end_frame. materials are returned separately
 * so a plugin can merge them or forward the bag in its own dialect.
 */
var HOST_IMAGE_KEYS = [
  "images", "image", "image_url", "image_urls",
  "reference_images", "reference_image", "reference_image_urls", "input_reference",
  "referenceImages", "imageUrls", "referenceImage", "imageRefs", "image_refs",
];
var HOST_VIDEO_KEYS = [
  "videos", "video", "video_url", "video_urls",
  "reference_videos", "reference_video", "reference_video_urls",
  "referenceVideos", "videoUrls", "referenceVideo", "videoRefs", "video_refs",
];
var HOST_AUDIO_KEYS = [
  "audios", "audio", "audio_url", "audio_urls",
  "reference_audios", "reference_audio", "reference_audio_urls", "reference_voice",
  "referenceAudios", "audioUrls", "referenceAudio", "audioRefs", "audio_refs",
];
var HOST_FIRST_FRAME_KEYS = [
  "first_frame_url", "start_frame_url", "start_frame", "first_frame", "first_image", "start_image",
];
var HOST_END_FRAME_KEYS = [
  "end_frame_url", "last_frame_url", "end_frame", "last_frame", "last_image", "lastFrameUrl",
];
var HOST_MEDIA_DROP_KEYS = HOST_IMAGE_KEYS.concat(HOST_VIDEO_KEYS, HOST_AUDIO_KEYS, HOST_FIRST_FRAME_KEYS, HOST_END_FRAME_KEYS)
  .filter(function (key) { return key !== "images" && key !== "videos" && key !== "audios"; });

function hostMediaPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hostMediaTrim(value) {
  return String(value == null ? "" : value).trim();
}

function hostMediaFrameType(value) {
  const raw = hostMediaTrim(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "first_frame" || raw === "start_frame" || raw === "firstframe" || raw === "startframe") return "first_frame";
  if (raw === "end_frame" || raw === "last_frame" || raw === "endframe" || raw === "lastframe") return "end_frame";
  return "";
}

function hostMediaMetadata(req) {
  if (!hostMediaPlainObject(req) || !hostMediaPlainObject(req.metadata)) return null;
  return req.metadata;
}

function hostMediaPushRaw(bucket, value, fallbackType) {
  if (value == null || value === "") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) hostMediaPushRaw(bucket, value[i], fallbackType);
    return;
  }
  if (hostMediaPlainObject(value)) {
    if (value.__fileRef || value.fileRef) {
      bucket.push({ fileRef: String(value.__fileRef || value.fileRef), name: hostMediaTrim(value.name), type: hostMediaFrameType(value.type) || fallbackType || "", _src: bucket._src || "" });
      return;
    }
    const fileId = hostMediaTrim(value.fileId || value.file_id);
    const assetId = hostMediaTrim(value.asset_id);
    let url = hostMediaTrim(value.url || value.uri || value.href || value.source_url || value.source);
    if (!url && typeof value.image_url === "string") url = hostMediaTrim(value.image_url);
    if (!url && hostMediaPlainObject(value.image_url)) url = hostMediaTrim(value.image_url.url);
    if (!url && typeof value.video_url === "string") url = hostMediaTrim(value.video_url);
    if (!url && typeof value.audio_url === "string") url = hostMediaTrim(value.audio_url);
    const item = { _src: bucket._src || "" };
    if (url) item.url = url;
    else if (fileId && !/^https?:\/\//i.test(fileId)) item.fileId = fileId;
    else if (assetId) item.asset_id = assetId;
    else return;
    const name = hostMediaTrim(value.name);
    if (name) item.name = name;
    const typed = hostMediaFrameType(value.type) || fallbackType || "";
    if (typed) item.type = typed;
    bucket.push(item);
    return;
  }
  const text = hostMediaTrim(value);
  if (!text) return;
  if (/^https?:\/\//i.test(text) || /^data:/i.test(text)) {
    const item = { url: text, _src: bucket._src || "" };
    if (fallbackType) item.type = fallbackType;
    bucket.push(item);
    return;
  }
  bucket.push({ fileId: text, _src: bucket._src || "", type: fallbackType || "" });
}

function hostMediaTake(req, keys, fallbackType) {
  const bucket = [];
  const meta = hostMediaMetadata(req);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    bucket._src = key;
    if (hostMediaPlainObject(req) && Object.prototype.hasOwnProperty.call(req, key)) hostMediaPushRaw(bucket, req[key], fallbackType);
    if (meta && Object.prototype.hasOwnProperty.call(meta, key)) hostMediaPushRaw(bucket, meta[key], fallbackType);
  }
  return bucket;
}

function hostMediaIdentity(item) {
  if (!item) return "";
  if (item.url) return "u:" + item.url;
  if (item.fileId) return "f:" + item.fileId;
  if (item.asset_id) return "a:" + item.asset_id;
  if (item.fileRef) return "r:" + item.fileRef;
  return "";
}

function hostMediaDedupe(items, withType) {
  const out = [];
  const index = {};
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const id = hostMediaIdentity(item);
    if (!id) continue;
    const key = withType ? id + "|" + (item.type || "") : id;
    if (Object.prototype.hasOwnProperty.call(index, key)) {
      const prev = out[index[key]];
      if (!prev.type && item.type) prev.type = item.type;
      if (!prev.name && item.name) prev.name = item.name;
      continue;
    }
    index[key] = out.length;
    const copy = {};
    if (item.url) copy.url = item.url;
    if (item.fileId) copy.fileId = item.fileId;
    if (item.asset_id) copy.asset_id = item.asset_id;
    if (item.fileRef) copy.fileRef = item.fileRef;
    if (item.name) copy.name = item.name;
    if (item.type) copy.type = item.type;
    if (item._src) copy._src = item._src;
    out.push(copy);
  }
  return out;
}

function hostMediaMaterials(req) {
  const lists = [];
  if (hostMediaPlainObject(req) && Array.isArray(req.materials)) lists.push(req.materials);
  const meta = hostMediaMetadata(req);
  if (meta && Array.isArray(meta.materials)) lists.push(meta.materials);
  const out = [];
  for (let l = 0; l < lists.length; l++) {
    const list = lists[l];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!hostMediaPlainObject(item)) continue;
      const bucket = [];
      bucket._src = "materials";
      hostMediaPushRaw(bucket, item, "");
      if (!bucket.length) continue;
      const got = bucket[0];
      const typ = hostMediaTrim(item.type).toLowerCase();
      got.materialType = typ || "image";
      delete got.type;
      out.push(got);
    }
  }
  return out;
}

function collectHostMedia(req) {
  const images = hostMediaTake(req, HOST_IMAGE_KEYS, "");
  const first = hostMediaTake(req, HOST_FIRST_FRAME_KEYS, "first_frame");
  const end = hostMediaTake(req, HOST_END_FRAME_KEYS, "end_frame");
  const videos = hostMediaDedupe(hostMediaTake(req, HOST_VIDEO_KEYS, ""), false);
  const audios = hostMediaDedupe(hostMediaTake(req, HOST_AUDIO_KEYS, ""), false);
  const mergedImages = hostMediaDedupe(first.concat(images, end), false);
  return {
    images: mergedImages,
    videos: videos,
    audios: audios,
    materials: hostMediaMaterials(req),
  };
}

function hostMediaPublish(item, stripFrameType) {
  if (!item) return item;
  const type = stripFrameType ? "" : (item.type || "");
  const name = item.name || "";
  const fileRef = item.fileRef || "";
  const assetId = item.asset_id || "";
  const fileId = item.fileId || "";
  const url = item.url || "";
  if (fileRef) return { fileRef: fileRef, name: name };
  if (assetId && !url) return { asset_id: assetId };
  if (!url && fileId) return fileId;
  if (!name && !type && !fileId && !assetId) return url;
  const out = {};
  if (url) out.url = url;
  if (fileId && !url) out.fileId = fileId;
  if (assetId) out.asset_id = assetId;
  if (name) out.name = name;
  if (type) out.type = type;
  return out;
}

function hostMediaFoldMaterials(media, images, videos, audios) {
  const seen = {};
  const mark = function (list) {
    for (let i = 0; i < list.length; i++) {
      const id = hostMediaIdentity(list[i]);
      if (id) seen[id] = true;
    }
  };
  mark(images);
  mark(videos);
  mark(audios);
  for (let i = 0; i < media.materials.length; i++) {
    const item = media.materials[i];
    const id = hostMediaIdentity(item);
    if (!id || seen[id]) continue;
    seen[id] = true;
    const typ = item.materialType || "";
    const copy = {};
    if (item.url) copy.url = item.url;
    if (item.fileId) copy.fileId = item.fileId;
    if (item.asset_id) copy.asset_id = item.asset_id;
    if (item.fileRef) copy.fileRef = item.fileRef;
    if (item.name) copy.name = item.name;
    copy._src = "materials";
    if (typ === "video" || typ === "reference_video") videos.push(copy);
    else if (typ === "audio" || typ === "reference_audio" || typ === "reference_voice" || typ === "voice") audios.push(copy);
    else {
      const frame = hostMediaFrameType(typ);
      if (frame) copy.type = frame;
      images.push(copy);
    }
  }
}

function applyHostMediaAliases(req, opts) {
  opts = opts || {};
  if (!hostMediaPlainObject(req)) return req;
  const media = collectHostMedia(req);
  const preserve = {};
  const preserved = opts.preserveKeys || [];
  for (let i = 0; i < preserved.length; i++) preserve[preserved[i]] = true;
  const images = [];
  const videos = [];
  const audios = [];
  for (let i = 0; i < media.images.length; i++) {
    const item = media.images[i];
    if (preserve[item._src]) continue;
    if (opts.foldFrames === false && item.type) continue;
    images.push(item);
  }
  for (let i = 0; i < media.videos.length; i++) {
    if (!preserve[media.videos[i]._src]) videos.push(media.videos[i]);
  }
  for (let i = 0; i < media.audios.length; i++) {
    if (!preserve[media.audios[i]._src]) audios.push(media.audios[i]);
  }
  if (opts.mergeMaterials) hostMediaFoldMaterials(media, images, videos, audios);
  if (opts.rejectNonImage) {
    if (videos.length || audios.length) throw new Error(opts.rejectNonImage);
    for (let i = 0; i < media.materials.length; i++) {
      const typ = media.materials[i].materialType || "";
      if (typ === "video" || typ === "audio" || typ === "reference_video" || typ === "reference_audio" || typ === "reference_voice" || typ === "voice") {
        throw new Error(opts.rejectNonImage);
      }
    }
  }
  const next = {};
  const keys = Object.keys(req);
  for (let i = 0; i < keys.length; i++) next[keys[i]] = req[keys[i]];
  const publishList = function (list) {
    const out = [];
    for (let i = 0; i < list.length; i++) out.push(hostMediaPublish(list[i], !!opts.stripFrameType));
    return out;
  };
  if (images.length) next.images = publishList(images);
  else if (!preserve.images) delete next.images;
  if (videos.length) next.videos = publishList(videos);
  else if (!preserve.videos) delete next.videos;
  if (audios.length) next.audios = publishList(audios);
  else if (!preserve.audios) delete next.audios;
  for (let i = 0; i < HOST_MEDIA_DROP_KEYS.length; i++) {
    const key = HOST_MEDIA_DROP_KEYS[i];
    if (preserve[key]) continue;
    delete next[key];
  }
  if (opts.foldFrames !== false) {
    for (let i = 0; i < HOST_FIRST_FRAME_KEYS.length; i++) if (!preserve[HOST_FIRST_FRAME_KEYS[i]]) delete next[HOST_FIRST_FRAME_KEYS[i]];
    for (let i = 0; i < HOST_END_FRAME_KEYS.length; i++) if (!preserve[HOST_END_FRAME_KEYS[i]]) delete next[HOST_END_FRAME_KEYS[i]];
  }
  if (opts.mergeMaterials) {
    delete next.materials;
  }
  if (hostMediaPlainObject(next.metadata)) {
    const metadata = {};
    const metaKeys = Object.keys(next.metadata);
    for (let i = 0; i < metaKeys.length; i++) metadata[metaKeys[i]] = next.metadata[metaKeys[i]];
    for (let i = 0; i < HOST_MEDIA_DROP_KEYS.length; i++) {
      if (!preserve[HOST_MEDIA_DROP_KEYS[i]]) delete metadata[HOST_MEDIA_DROP_KEYS[i]];
    }
    if (opts.foldFrames !== false) {
      for (let i = 0; i < HOST_FIRST_FRAME_KEYS.length; i++) delete metadata[HOST_FIRST_FRAME_KEYS[i]];
      for (let i = 0; i < HOST_END_FRAME_KEYS.length; i++) delete metadata[HOST_END_FRAME_KEYS[i]];
    }
    delete metadata.images;
    delete metadata.videos;
    delete metadata.audios;
    if (opts.mergeMaterials) delete metadata.materials;
    next.metadata = metadata;
  }
  return next;
}


export function buildSubmitRequest(ctx) {
  const body = buildUpstreamBody(ctx || {});
  return {
    url: upstreamOrigin(ctx && ctx.baseUrl) + "/v1/videos",
    method: "POST",
    headers: {
      Authorization: authorizationHeader(ctx),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body,
    action: body.reference_images ? "image_to_video" : "text_to_video",
  };
}

export function parseSubmitResponse(_ctx, resp) {
  const body = resp && resp.body;
  const taskId = readTaskId(body);
  if (!taskId) {
    const top = object(body) ? body : {};
    const nested = object(top.data) ? top.data : {};
    throw new Error(errorText(top.error || nested.error) || "task_id is empty");
  }
  return { taskId: taskId, taskData: object(body) ? body : { id: taskId } };
}

export function buildQueryRequest(ctx) {
  const taskId = trimmed(ctx && ctx.taskId);
  if (!taskId) throw new Error("task_id is empty");
  return {
    url: upstreamOrigin(ctx && ctx.baseUrl) + "/v1/videos/" + encodeURIComponent(taskId),
    method: "GET",
    headers: {
      Authorization: authorizationHeader(ctx),
      Accept: "application/json",
    },
  };
}

export function parseTaskResult(_ctx, body) {
  // Query failures stay on this task id. Returning UNKNOWN (or throwing) lets
  // the host count a poll failure; this function never builds another submit.
  const source = statusSource(body);
  const raw = source.status;
  const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const status = STATUS_MAP[key];
  if (!status) {
    const top = object(body) ? body : {};
    const message = errorText(source.error || top.error);
    return { status: "UNKNOWN", reason: message || "unrecognized status: " + String(raw || "") };
  }
  const result = { status: status };
  const progress = progressText(source.progress, status);
  if (progress !== undefined) result.progress = progress;
  if (status === "FAILURE") result.reason = failureReason(source);
  if (status === "SUCCESS") {
    const url = resultMediaUrl(body);
    if (url) {
      result.url = url;
      result.remoteUrl = url;
    }
  }
  return result;
}

export function extractUsage(_ctx) {
  return { seconds: SECONDS };
}

export function extractUsageOnComplete(_task, _result, _body) {
  return { seconds: SECONDS };
}

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  return [{ key: "video", type: "video", mimeType: "video/mp4" }];
}

export function buildContentRequest(ctx) {
  if (!ctx || ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const method = String((ctx.clientRequest && ctx.clientRequest.method) || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new Error("Video content supports GET and HEAD only");
  const media = resultMediaUrl(ctx.data);
  // Public video_url / result_url needs no channel key. credentialless also
  // forbids plugin-supplied headers; the host copies Range and validators.
  if (media) return { url: media, method: method, credentialless: true };
  // No usable CDN URL (missing or expires_at already passed). 9Y may answer
  // GET /content with HTTP 503 and Retry-After while the archive is pending
  // (video_archive_pending). The host media proxy forwards Retry-After only
  // for upstream HTTP 429 (client sees 503 artifact_upstream_busy). Upstream
  // 503 becomes 502 artifact_upstream_error without Retry-After. This plugin
  // cannot read the content response, so it does not retry or resubmit.
  const taskId = trimmed(ctx.upstreamTaskId || ctx.taskId);
  if (!taskId) throw new Error("artifact_not_found");
  return {
    url: upstreamOrigin(ctx.baseUrl) + "/v1/videos/" + encodeURIComponent(taskId) + "/content",
    method: method,
    headers: { Authorization: authorizationHeader(ctx) },
  };
}

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
    // The host replaces a decodeRequest throw with a generic invalid-model
    // error. Structural mismatches still return a submit intent so
    // buildSubmitRequest can raise the message callers actually see.
    decodeRequest: function (ctx) {
      const model = trimmed(ctx && ctx.model);
      if (!model) throw invalidRequest("model is required");
      const body = ctx && ctx.body;
      if (!body || body.kind !== "json" || !object(body.value)) {
        return { kind: "submit", model: model, action: "text_to_video", requestBody: null };
      }
      return {
        kind: "submit",
        model: model,
        action: actionOf(body.value),
        requestBody: body.value,
      };
    },
    render: function (_ctx, task) {
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
      return output;
    },
  },
};
