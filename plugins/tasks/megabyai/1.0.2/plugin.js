/**
 * MegaAi (megabyai) — NewAPI Task Plugin API v1.
 *
 * Relays host-owned openai_video calls to MegaAi's documented video API:
 *   POST /v1/videos
 *   GET  /v1/videos/{task_id}
 *   GET|HEAD /v1/videos/{task_id}/content
 * Docs: https://megaviews.top/docs (same text on the other three hosts).
 *
 * The channel base is the site origin (https://megaviews.top and the documented
 * aliases). This file appends /v1/.... A base that already ends in /v1 is
 * accepted once so the request is not sent to /v1/v1/videos.
 *
 * The JSON body is a whitelist. Host public images/videos/audios (and the
 * usual aliases, including materials) are written as MegaAi
 * referenceImages/referenceVideos/referenceAudios. Scalar fields duration,
 * seconds, ratio, aspect_ratio, resolution, video_resolution, seed, size,
 * prompt, and metadata are copied. Unknown keys are not forwarded. seconds
 * and duration are only cross-read for the same 1..3600 check sora performs.
 * Multipart follows sora, including copying a lone duration form field onto
 * numeric seconds.
 *
 * Bind a Task Plugin channel with task_plugin_key megabyai.
 * Legacy channel type numbers are intentionally absent. No API key is embedded.
 */
const VIDEO_MODELS = [
  "S-seedance-2.5-480p",
  "T1-seedance-2.5",
  "T2-seedance-2.5",
  "T3-seedance-2.5",
  "bb-2.5-301010",
  "minimax-h3-f",
  "minimax_h3_zm_u24",
  "sd-2.0",
  "sd-2.5-720p",
  "sd-fast",
  "sd-mini",
  "sd2.5-pro",
  "sd2.5max900",
  "seedance-2.0-fast-m1",
  "seedance-2.0-m1",
  "seedance-2.0-mini-m1",
  "seedance-2.5-m1",
  "seedance-2.5-m3",
  "video-sd20-10s",
  "wan-3.0",
  "wan3.0-video",
  "wan3.0-video-prime",
  "seedance-2.0-fast-m2",
  "seedance-2.0-fast-m2-480p",
  "seedance-2.0-fast-m2-720p",
  "seedance-2.0-m2",
  "seedance-2.0-m2-480p",
  "seedance-2.0-m2-720p",
  "seedance-2.0-m2-1080p",
  "seedance-2.0-m2-4k",
  "seedance-2.0-mini-m2",
  "seedance-2.0-mini-m2-480p",
  "seedance-2.0-mini-m2-720p",
  "seedance-2.5-480p-m2",
  "seedance-2.5-480p-m2-480p",
  "seedance-2.5-flf-m2",
  "seedance-2.5-flf-m2-480p",
  "seedance-2.5-flf-m2-720p",
  "seedance-2.5-flf-m2-1080p",
  "seedance-2.5-m2",
  "seedance-2.5-m2-480p",
  "seedance-2.5-m2-720p",
  "seedance-2.5-m2-1080p",
  "T1-seedance-2.5-480p",
  "T1-seedance-2.5-720p",
];

export const meta = {
  apiVersion: 1,
  key: "megabyai",
  name: "MegaAi",
  icon: "text:Mega",
  description: {
    en: "MegaAi video generation via the OpenAI-compatible /v1/videos API. Channel base is the site origin, for example https://megaviews.top",
    zh: "通过 MegaAi 的 OpenAI 兼容视频接口（/v1/videos）生成视频。渠道 Base URL 填站点根地址，例如 https://megaviews.top",
  },
  version: "1.0.2",
  author: { name: "Wolf-Totem", url: "https://megaviews.top" },
  models: VIDEO_MODELS,
  fetchMode: "per_task",
  allowedHosts: ["megaviews.top", "www.megaviews.top", "newapi.megaviews.top", "newapi.megabyai.cc"],
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Requested video duration in seconds.", zh: "请求的视频时长，单位为秒。" },
    },
  },
  protocols: [{ name: "openai_video", models: VIDEO_MODELS }],
};

function trimmed(value) {
  return String(value || "").trim();
}

function upstreamOrigin(baseUrl) {
  let base = trimmed(baseUrl).replace(/\/+$/, "");
  if (/\/v1$/i.test(base)) base = base.slice(0, -3);
  if (!/^https?:\/\//i.test(base)) throw new Error("base URL is required");
  return base;
}

function outboundModel(ctx) {
  const model = trimmed(ctx && ctx.upstreamModel) || trimmed(ctx && ctx.model);
  if (!model) throw new Error("model is required");
  return model;
}

const MEGABYAI_SCALARS = ["prompt", "duration", "seconds", "ratio", "aspect_ratio", "resolution", "video_resolution", "seed", "size"];

function megabyaiList(items) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    if (item.fileRef) throw new Error("file upload must use multipart input_reference");
    if (item.type || item.name) {
      const entry = {};
      if (item.url) entry.url = item.url;
      if (item.name) entry.name = item.name;
      if (item.type) entry.type = item.type;
      out.push(entry);
      continue;
    }
    out.push(item.url || item.fileId || item.asset_id);
  }
  return out;
}

function requestValues(req, model) {
  const source = req && typeof req === "object" && !Array.isArray(req) ? req : {};
  const media = collectHostMedia(source);
  const images = media.images.slice();
  const videos = media.videos.slice();
  const audios = media.audios.slice();
  hostMediaFoldMaterials(media, images, videos, audios);
  const values = { model: model };
  for (let i = 0; i < MEGABYAI_SCALARS.length; i++) {
    const key = MEGABYAI_SCALARS[i];
    if (source[key] !== undefined && source[key] !== null) values[key] = source[key];
  }
  if (hostMediaPlainObject(source.metadata)) {
    const metadata = {};
    const metaKeys = Object.keys(source.metadata);
    for (let i = 0; i < metaKeys.length; i++) metadata[metaKeys[i]] = source.metadata[metaKeys[i]];
    for (let i = 0; i < HOST_MEDIA_DROP_KEYS.length; i++) delete metadata[HOST_MEDIA_DROP_KEYS[i]];
    for (let i = 0; i < HOST_FIRST_FRAME_KEYS.length; i++) delete metadata[HOST_FIRST_FRAME_KEYS[i]];
    for (let i = 0; i < HOST_END_FRAME_KEYS.length; i++) delete metadata[HOST_END_FRAME_KEYS[i]];
    delete metadata.images;
    delete metadata.videos;
    delete metadata.audios;
    delete metadata.materials;
    if (Object.keys(metadata).length) values.metadata = metadata;
  }
  const referenceImages = megabyaiList(images);
  const referenceVideos = megabyaiList(videos);
  const referenceAudios = megabyaiList(audios);
  if (referenceImages.length) values.referenceImages = referenceImages;
  if (referenceVideos.length) values.referenceVideos = referenceVideos;
  if (referenceAudios.length) values.referenceAudios = referenceAudios;
  return values;
}

function authorizationHeader(ctx) {
  const key = trimmed(ctx && ctx.apiKey);
  if (!key) throw new Error("api key is required");
  return "Bearer " + key;
}

function assertDuration(seconds) {
  if (seconds === undefined) return;
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0 || value > 3600) throw new Error("seconds must be between 1 and 3600");
}

function readTaskId(body) {
  const top = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  if (top.id || top.task_id) return top.id || top.task_id;
  const data = top.data;
  if (data && typeof data === "object" && !Array.isArray(data) && (data.id || data.task_id)) return data.id || data.task_id;
  return "";
}

function statusSource(body) {
  const top = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  if (top.status !== undefined) return top;
  const data = top.data;
  if (data && typeof data === "object" && !Array.isArray(data) && data.status !== undefined) return data;
  return top;
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
  const req = ctx.requestBody || {};
  if (!String(req.prompt || "").trim()) throw new Error("field prompt is required");
  const headers = { Authorization: authorizationHeader(ctx) };
  const url = upstreamOrigin(ctx.baseUrl) + "/v1/videos";
  if ((ctx.files || []).length) {
    const parts = [];
    const values = requestValues(req, outboundModel(ctx));
    for (const key of Object.keys(values)) {
      if (values[key] !== undefined && values[key] !== null && typeof values[key] !== "object") parts.push({ name: key, value: values[key] });
    }
    if (values.metadata && typeof values.metadata === "object" && !Array.isArray(values.metadata)) {
      parts.push({ name: "metadata", value: JSON.stringify(values.metadata) });
    }
    for (const file of ctx.files) parts.push({ name: file.field, fileRef: file.ref, filename: file.filename });
    return { url: url, method: "POST", headers: headers, bodyType: "multipart", parts: parts };
  }
  headers["Content-Type"] = "application/json";
  return { url: url, method: "POST", headers: headers, body: requestValues(req, outboundModel(ctx)) };
}

export function parseSubmitResponse(ctx, resp) {
  const body = (resp && resp.body) || {};
  const taskId = readTaskId(body);
  if (!taskId) throw new Error("task_id is empty");
  return { taskId: taskId, taskData: body };
}

export function extractUsage(ctx) {
  const req = (ctx && ctx.requestBody) || {};
  let seconds = Number(req.seconds || req.duration || 4);
  if (!Number.isFinite(seconds) || seconds <= 0) seconds = 4;
  return { seconds: Math.min(seconds, 3600) };
}

export function extractUsageOnComplete(task, taskResult, body) {
  const facts = {};
  const seconds = Number((body || {}).seconds || (body || {}).duration || 0);
  if (Number.isFinite(seconds) && seconds > 0) facts.seconds = Math.min(seconds, 3600);
  return facts;
}

export function buildQueryRequest(ctx) {
  return {
    url: upstreamOrigin(ctx.baseUrl) + "/v1/videos/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Authorization: authorizationHeader(ctx) },
  };
}

export function parseTaskResult(ctx, body) {
  const source = statusSource(body);
  const statuses = {
    queued: "QUEUED",
    pending: "QUEUED",
    processing: "IN_PROGRESS",
    in_progress: "IN_PROGRESS",
    completed: "SUCCESS",
    succeeded: "SUCCESS",
    failed: "FAILURE",
    cancelled: "FAILURE",
  };
  const raw = source.status;
  const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const mapped = statuses[key];
  const result = { status: mapped || "UNKNOWN" };
  if (!mapped) result.reason = "unrecognized status: " + String(raw || "");
  if (source.progress > 0 && source.progress < 100) result.progress = source.progress + "%";
  if (result.status === "FAILURE") {
    const message = source.error && source.error.message;
    result.reason = message ? message : typeof source.fail_reason === "string" && source.fail_reason ? source.fail_reason : "task failed";
  }
  return result;
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  return {
    url: upstreamOrigin(ctx.baseUrl) + "/v1/videos/" + encodeURIComponent(ctx.upstreamTaskId) + "/content",
    method: ctx.clientRequest.method,
    headers: { Authorization: authorizationHeader(ctx) },
  };
}

const legacyRenderers = {
  openai_video: function (task) {
    const statuses = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "in_progress", SUCCESS: "completed", FAILURE: "failed" };
    const output = {
      id: task.task_id,
      object: "video",
      model: (task.properties || {}).origin_model_name || "",
      status: statuses[task.status] || "unknown",
      progress: Number(String(task.progress || "0").replace("%", "")),
      created_at: Number(task.created_at || 0),
    };
    const completedAt = Number(task.finished_at || task.updated_at || 0);
    if (completedAt > 0) output.completed_at = completedAt;
    if (task.status === "FAILURE") {
      output.error = { code: "video_generation_failed", message: "The video generation task failed." };
    }
    return output;
  },
};

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
      if (!trimmed(ctx.model)) throw new Error("model is required");
      if (ctx.body.kind === "json") {
        if (!ctx.body.value || Array.isArray(ctx.body.value)) throw new Error("JSON object required");
        const req = ctx.body.value;
        const seconds = req.seconds === undefined ? req.duration : req.seconds;
        assertDuration(seconds);
        return {
          kind: "submit",
          model: ctx.model,
          action: req.input_reference || req.image ? "image_to_video" : "text_to_video",
          requestBody: requestValues(req, ctx.model),
        };
      }
      const first = function (name) {
        const values = (ctx.body.fields || {})[name] || [];
        if (values.length > 1) throw new Error(name + " must be provided once");
        return values[0];
      };
      const req = {};
      const fields = ctx.body.fields || {};
      for (const name of Object.keys(fields)) {
        req[name] = first(name);
      }
      let hasInputReferenceFile = false;
      for (const file of ctx.body.files || []) {
        if (file.field !== "input_reference") throw new Error("unexpected file field: " + file.field);
        if (hasInputReferenceFile) throw new Error("input_reference must be provided once");
        hasInputReferenceFile = true;
      }
      if (req.metadata !== undefined) {
        let parsed;
        try {
          parsed = JSON.parse(req.metadata);
        } catch (e) {
          throw new Error("metadata must be a JSON object string");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("metadata must be a JSON object string");
        req.metadata = parsed;
      }
      if (req.seconds !== undefined) req.seconds = Number(req.seconds);
      else if (req.duration !== undefined) req.seconds = Number(req.duration);
      const seconds = req.seconds === undefined ? req.duration : req.seconds;
      assertDuration(seconds);
      return {
        kind: "submit",
        model: ctx.model,
        action: hasInputReferenceFile || req.input_reference || req.image ? "image_to_video" : "text_to_video",
        requestBody: requestValues(req, ctx.model),
      };
    },
    render: function (ctx, task) {
      return legacyRenderers.openai_video(task);
    },
  },
};
