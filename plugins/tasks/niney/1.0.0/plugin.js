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
  version: "1.0.0",
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
  const req = ctx && ctx.requestBody;
  if (!object(req)) throw invalidRequest("JSON object required");
  rejectKeyedMedia(req);
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
