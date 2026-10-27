// SD2.5 / Seedance 2.5 video plugin for NewAPI Task Plugin API v1.
// Upstream is OpenAI-compatible video (POST /v1/videos on the channel base, e.g. https://sd25.app).
// Connection settings stay on the channel. This file does not embed keys or a fixed upstream list.
//
// Model identities (1.1.0):
// - Wire body.model sent upstream is always the literal "seedance-2.5".
// - decodeRequest must return the pinned model verbatim (host: resolved == pinned).
// - buildSubmitRequest ctx.model is OriginModelName (client / facade name) and
//   ctx.upstreamModel is the name after channel model_mapping. Both are legal
//   inputs. Do not set descriptor model or rewriteModel: on a pinned endpoint
//   the host requires a top-level model to echo the pin, and rewriteModel
//   replaces UpstreamModelName used for billing.
const MODEL = "seedance-2.5";
// Names the host may pin. Facades are listed so OriginModelName is a declared
// model when it shows up as the pin. param_routing still maps 特惠-1/2 onto
// the app-秒 / app-条 aliases for exclusive channel abilities.
const DECLARED_MODELS = [
  "seedance-2.5",
  "seedance-2.5-app-秒",
  "seedance-2.5-app-条",
  "sd2.5-G3-特惠-1",
  "sd2.5-G3-特惠-2",
];
// Later facades of the same family (特惠-3, …) stay acceptable at submit time
// even before they are added to meta.models. Channel model_mapping can pin
// them as aliases of a declared model.
const FACADE_MODEL = /^sd2\.5-G3-特惠-[1-9][0-9]*$/;

function isDeclaredModel(value) {
  return typeof value === "string" && DECLARED_MODELS.indexOf(value) !== -1;
}
function isFacadeModel(value) {
  return typeof value === "string" && FACADE_MODEL.test(value);
}
function isRecognizedModel(value) {
  return isDeclaredModel(value) || isFacadeModel(value);
}
// hostNames are identities this call already carries (pinned model, OriginModelName, UpstreamModelName).
function acceptsModel(value, hostNames) {
  if (isRecognizedModel(value)) return true;
  if (!hostNames) return false;
  for (let i = 0; i < hostNames.length; i++) {
    if (hostNames[i] && value === hostNames[i]) return true;
  }
  return false;
}
function hostIdentities(ctx) {
  const names = [];
  if (ctx && typeof ctx.model === "string" && ctx.model) names.push(ctx.model);
  if (ctx && typeof ctx.upstreamModel === "string" && ctx.upstreamModel) names.push(ctx.upstreamModel);
  return names;
}
function modelError() {
  return new Error("model must be seedance-2.5 or a declared SD2.5 name");
}
const SIZES = {
  "854x480": "480p", "480x854": "480p", "640x480": "480p", "480x640": "480p",
  "480x480": "480p", "1120x480": "480p", "adaptive-480p": "480p",
  "1280x720": "720p", "720x1280": "720p", "960x720": "720p", "720x960": "720p",
  "720x720": "720p", "1680x720": "720p", "adaptive-720p": "720p",
  "1920x1080": "1080p", "1080x1920": "1080p", "1440x1080": "1080p", "1080x1440": "1080p",
  "1080x1080": "1080p", "2520x1080": "1080p", "adaptive-1080p": "1080p",
};
const SIZES_BY_RESOLUTION = {
  "480p": { "16:9": "854x480", "9:16": "480x854", "4:3": "640x480", "3:4": "480x640", "1:1": "480x480", "21:9": "1120x480", adaptive: "adaptive-480p" },
  "720p": { "16:9": "1280x720", "9:16": "720x1280", "4:3": "960x720", "3:4": "720x960", "1:1": "720x720", "21:9": "1680x720", adaptive: "adaptive-720p" },
  "1080p": { "16:9": "1920x1080", "9:16": "1080x1920", "4:3": "1440x1080", "3:4": "1080x1440", "1:1": "1080x1080", "21:9": "2520x1080", adaptive: "adaptive-1080p" },
};

export const meta = {
  apiVersion: 1,
  key: "sd25_video",
  name: "SD2.5",
  icon: "text:SD",
  version: "1.1.0",
  author: { name: "SD2.5", url: "https://sd25.app" },
  website: "https://sd25.app",
  baseUrl: "https://sd25.app",
  description: {
    en: "Seedance 2.5 video on sd25.app via the OpenAI video API. Duration, resolution, audio, and reference media",
    zh: "通过 sd25.app 的 OpenAI 视频接口生成 Seedance 2.5。支持时长、分辨率、声音与参考素材",
  },
  models: DECLARED_MODELS,
  fetchMode: "per_task",
  protocols: [{ name: "openai_video", models: DECLARED_MODELS }],
  usageSchema: {
    seconds: { type: "number", unit: "second", description: { en: "Video generation unit price", zh: "视频生成单价" } },
    resolution: { enum: ["480p", "720p", "1080p"], description: { en: "Output video resolution", zh: "输出视频分辨率" } },
    enable_audio: { type: "boolean", description: { en: "Whether audio is generated", zh: "是否生成音频" } },
  },
  usageExamples: [
    { label: "720P · 5秒 · 有声", facts: { seconds: 5, resolution: "720p", enable_audio: true } },
    { label: "720P · 30秒 · 静音", facts: { seconds: 30, resolution: "720p", enable_audio: false } },
  ],
};

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function onlyFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(label + ": unsupported field " + key);
  }
}
function ensureRequestSize(value) {
  // normalize() has already validated every inline media input as ASCII
  // Base64. Count those strings by length without serializing or walking
  // their bytes in JavaScript. The replacement keeps their JSON quotes.
  let bytes = 0;
  const text = JSON.stringify(value, function (key, item) {
    if (typeof item === "string" && ((key === "image_url" && item.startsWith("data:image/")) || (key === "video_url" && item.startsWith("data:video/mp4;base64,")) || (key === "audio_url" && item.startsWith("data:audio/")))) {
      bytes += item.length;
      return "";
    }
    return item;
  });
  const limit = 67108864;
  const tooLarge = "video request exceeds 64 MiB JSON limit; reduce inline media size or use HTTP(S) media URLs";
  if (bytes > limit) throw new Error(tooLarge);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 55296 && code <= 56319 && i + 1 < text.length && text.charCodeAt(i + 1) >= 56320 && text.charCodeAt(i + 1) <= 57343) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes > limit) throw new Error(tooLarge);
  }
}
function integerSeconds(value) {
  if (typeof value === "string" && !/^\d+$/.test(value)) throw new Error("seconds must be an integer from 4 to 30");
  if (typeof value !== "number" && typeof value !== "string") throw new Error("seconds must be explicitly supplied");
  const n = Number(value);
  if (!Number.isInteger(n) || n < 4 || n > 30) throw new Error("seconds must be an integer from 4 to 30");
  return n;
}
function inlineImage(value, label) {
  const match = /^data:image\/(?:png|jpeg|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4 !== 0) throw new Error(label + " inline image must be PNG/JPEG/GIF with valid Base64");
  const encoded = match[1];
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const bytes = encoded.length / 4 * 3 - padding;
  if (bytes <= 0 || bytes > 33554432) throw new Error(label + " inline image exceeds 32 MiB");
  return value;
}
function reference(value, label) {
  if (typeof value === "string") value = { image_url: value };
  if (!object(value)) throw new Error(label + " must be an image URL or image_url/asset_id object");
  onlyFields(value, ["image_url", "asset_id"], label);
  const url = value.image_url;
  const asset = value.asset_id;
  if ((url !== undefined) === (asset !== undefined)) throw new Error(label + " requires exactly one image_url or asset_id");
  if (url !== undefined) {
    if (typeof url === "string" && url.startsWith("data:")) return { image_url: inlineImage(url, label) };
    if (typeof url !== "string" || !/^https?:\/\/[^\s]+$/.test(url)) throw new Error(label + " image_url must be an HTTP(S) URL");
    return { image_url: url };
  }
  if (typeof asset !== "string" || !/^asset_[a-f0-9]{32}$/.test(asset)) throw new Error(label + " asset_id is invalid");
  return { asset_id: asset };
}
function videoReference(value, label) {
  if (!object(value)) throw new Error(label + " must be a video_url/asset_id object");
  onlyFields(value, ["video_url", "asset_id"], label);
  const url = value.video_url;
  const asset = value.asset_id;
  if ((url !== undefined) === (asset !== undefined)) throw new Error(label + " requires exactly one video_url or asset_id");
  if (asset !== undefined) {
    if (typeof asset !== "string" || !/^asset_[a-f0-9]{32}$/.test(asset)) throw new Error(label + " asset_id is invalid");
    return { asset_id: asset };
  }
  if (typeof url === "string" && url.startsWith("data:")) {
    const match = /^data:video\/mp4;base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (!match || match[1].length % 4 !== 0) throw new Error(label + " inline video must be MP4 with valid Base64");
    const encoded = match[1];
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const bytes = encoded.length / 4 * 3 - padding;
    if (bytes <= 0 || bytes > 33554432) throw new Error(label + " inline video exceeds 32 MiB");
    return { video_url: url };
  }
  if (typeof url !== "string" || !/^https?:\/\/[^\s\/?#@]+(?:[/?][^\s#]*)?$/.test(url))
    throw new Error(label + " video_url must be an HTTP(S) URL without credentials or fragments");
  return { video_url: url };
}
function audioReference(value, label) {
  if (!object(value)) throw new Error(label + " must be an audio_url/asset_id object");
  onlyFields(value, ["audio_url", "asset_id"], label);
  const url = value.audio_url;
  const asset = value.asset_id;
  if ((url !== undefined) === (asset !== undefined)) throw new Error(label + " requires exactly one audio_url or asset_id");
  if (asset !== undefined) {
    if (typeof asset !== "string" || !/^asset_[a-f0-9]{32}$/.test(asset)) throw new Error(label + " asset_id is invalid");
    return { asset_id: asset };
  }
  if (typeof url === "string" && url.startsWith("data:")) {
    const match = /^data:audio\/(mpeg|mp3|wav|x-wav);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (!match || match[2].length % 4 !== 0) throw new Error(label + " inline audio must be MP3 or WAV with valid Base64");
    const encoded = match[2];
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const bytes = encoded.length / 4 * 3 - padding;
    if (bytes <= 0 || bytes > 33554432) throw new Error(label + " inline audio exceeds 32 MiB");
    const mime = match[1] === "mp3" || match[1] === "mpeg" ? "audio/mpeg" : "audio/wav";
    return { audio_url: "data:" + mime + ";base64," + encoded };
  }
  if (typeof url !== "string" || !/^https?:\/\/[^\s\/?#@]+(?:[/?][^\s#]*)?$/.test(url))
    throw new Error(label + " audio_url must be an HTTP(S) URL without credentials or fragments");
  return { audio_url: url };
}
function requestSize(req) {
  // Site clients often send size="720p" / ratio / video_resolution; map to official WxH size.
  let resolution = pickResolution(req);
  let aspect = pickAspect(req);
  let sizeRaw = has(req, "size") ? req.size : undefined;
  if (typeof sizeRaw === "string") {
    const asRes = asResolutionToken(sizeRaw);
    if (asRes) {
      if (resolution && resolution.trim().toLowerCase() !== asRes) throw new Error("size conflicts with resolution");
      resolution = asRes;
      sizeRaw = undefined;
    } else if (!has(SIZES, sizeRaw)) {
      throw new Error("size must be an explicitly supported pixel size, adaptive-480p/720p/1080p, or 480p/720p/1080p");
    }
  } else if (sizeRaw !== undefined) {
    throw new Error("size must be a string");
  }
  if (resolution === undefined && aspect === undefined) {
    if (typeof sizeRaw !== "string") throw new Error("size must be an explicitly supported pixel size or adaptive-480p/720p/1080p");
    return sizeRaw;
  }
  if (resolution === undefined) throw new Error("resolution is required when aspect_ratio/ratio is supplied");
  if (typeof resolution !== "string") throw new Error("resolution must be a string");
  resolution = resolution.trim().toLowerCase();
  if (!has(SIZES_BY_RESOLUTION, resolution)) throw new Error("resolution must be 480p, 720p or 1080p");
  // Docs require resolution+aspect_ratio together; site often omits ratio → default 16:9 (existing site convention).
  if (aspect === undefined) aspect = "16:9";
  if (typeof aspect !== "string") throw new Error("aspect_ratio must be a string");
  const ratio = aspect.trim().toLowerCase();
  if (!has(SIZES_BY_RESOLUTION[resolution], ratio)) throw new Error("aspect_ratio must be 16:9, 9:16, 4:3, 3:4, 1:1, 21:9 or adaptive");
  const size = SIZES_BY_RESOLUTION[resolution][ratio];
  if (sizeRaw !== undefined && sizeRaw !== size) throw new Error("size must match resolution and aspect_ratio");
  return size;
}
function asResolutionToken(value) {
  if (typeof value !== "string") return undefined;
  const t = value.trim().toLowerCase();
  return has(SIZES_BY_RESOLUTION, t) ? t : undefined;
}
function pickAspect(req) {
  const names = ["aspect_ratio", "ratio", "aspect"].filter(function (name) { return has(req, name); });
  if (!names.length) return undefined;
  const values = names.map(function (name) { return req[name]; });
  for (let i = 1; i < values.length; i++) {
    if (String(values[i]).trim().toLowerCase() !== String(values[0]).trim().toLowerCase()) throw new Error("aspect_ratio conflicts with ratio/aspect");
  }
  if (typeof values[0] !== "string") throw new Error("aspect_ratio must be a string");
  return values[0];
}
function pickResolution(req) {
  const names = ["resolution", "video_resolution"].filter(function (name) { return has(req, name); });
  if (!names.length) return undefined;
  const values = names.map(function (name) { return req[name]; });
  for (let i = 1; i < values.length; i++) {
    if (String(values[i]).trim().toLowerCase() !== String(values[0]).trim().toLowerCase()) throw new Error("resolution conflicts with video_resolution");
  }
  if (typeof values[0] !== "string") throw new Error("resolution must be a string");
  return values[0];
}
function mediaUrlField(value, urlKey) {
  if (typeof value === "string") {
    const o = {}; o[urlKey] = value; return o;
  }
  if (!object(value)) return value;
  if (value[urlKey] === undefined && typeof value.url === "string") {
    const o = {};
    for (const k of Object.keys(value)) if (k !== "url") o[k] = value[k];
    o[urlKey] = value.url;
    return o;
  }
  return value;
}
function collectMediaList(req, keys, mapItem, label, max) {
  const out = [];
  for (const key of keys) {
    if (!has(req, key)) continue;
    const raw = req[key];
    const list = Array.isArray(raw) ? raw : [raw];
    for (let i = 0; i < list.length; i++) out.push(mapItem(list[i], label + " " + (out.length + 1)));
  }
  if (out.length > max) throw new Error(label + " must contain at most " + max + " items");
  return out;
}
function claimedModel(req) {
  if (req.model !== undefined) return req.model;
  if (has(req, "model_id")) return req.model_id;
  return undefined;
}
function normalize(req, model, hostNames) {
  if (!object(req)) throw new Error("JSON object required");
  onlyFields(req, ["model", "model_id", "prompt", "seconds", "duration", "size", "resolution", "video_resolution", "aspect_ratio", "ratio", "aspect", "enable_audio", "reference_images", "images", "image_urls", "image_url", "reference_videos", "videos", "video_urls", "video_url", "reference_audios", "audios", "audio_urls", "audio_url", "first_frame", "last_frame", "input_reference", "image", "metadata", "extra_parameters"], "video request");
  // Read model / model_id without writing back into the host request object.
  const claimed = claimedModel(req);
  const identity = model || claimed;
  if (!acceptsModel(identity, hostNames) || (claimed !== undefined && !acceptsModel(claimed, hostNames))) throw modelError();
  const seconds = integerSeconds(has(req, "seconds") ? req.seconds : req.duration);
  if (has(req, "duration") && integerSeconds(req.duration) !== seconds) throw new Error("seconds and duration conflict");
  const size = requestSize(req);
  let audio = true;
  if (has(req, "enable_audio")) {
    if (typeof req.enable_audio !== "boolean") throw new Error("enable_audio must be a boolean");
    audio = req.enable_audio;
  }
  if (has(req, "extra_parameters")) {
    if (!object(req.extra_parameters)) throw new Error("extra_parameters must be an object");
    onlyFields(req.extra_parameters, ["enable_audio"], "extra_parameters");
    if (has(req.extra_parameters, "enable_audio")) {
      const extra = req.extra_parameters.enable_audio;
      if (typeof extra !== "boolean") throw new Error("enable_audio must be a boolean");
      if (has(req, "enable_audio") && extra !== audio) throw new Error("conflicting audio fields");
      audio = extra;
    }
  }
  const out = { model: MODEL, prompt: "", seconds: seconds, size: size, enable_audio: audio };
  if (req.prompt !== undefined) {
    if (typeof req.prompt !== "string") throw new Error("prompt must be a string");
    out.prompt = req.prompt;
  }
  const refs = collectMediaList(req, ["reference_images", "images", "image_urls", "image_url"], function (value, label) {
    return reference(mediaUrlField(value, "image_url"), label);
  }, "reference images", 30);
  if (refs.length) out.reference_images = refs;
  const refVideos = collectMediaList(req, ["reference_videos", "videos", "video_urls", "video_url"], function (value, label) {
    return videoReference(mediaUrlField(value, "video_url"), label);
  }, "reference videos", 10);
  if (refVideos.length) out.reference_videos = refVideos;
  const refAudios = collectMediaList(req, ["reference_audios", "audios", "audio_urls", "audio_url"], function (value, label) {
    return audioReference(mediaUrlField(value, "audio_url"), label);
  }, "reference audios", 10);
  if (refAudios.length) out.reference_audios = refAudios;
  const firstFields = ["first_frame", "input_reference", "image"].filter(function (name) { return has(req, name); });
  if (firstFields.length > 1) throw new Error("Use only one of first_frame, input_reference and image");
  if (firstFields.length) out.first_frame = reference(mediaUrlField(req[firstFields[0]], "image_url"), "first_frame");
  if (has(req, "last_frame")) out.last_frame = reference(mediaUrlField(req.last_frame, "image_url"), "last_frame");
  if (!out.prompt.trim() && !(out.reference_images || []).length && !(out.reference_videos || []).length && !out.first_frame && !out.last_frame) throw new Error("prompt or a reference image/video/frame is required");
  if (has(req, "metadata")) {
    if (!object(req.metadata)) throw new Error("metadata must be an object");
    onlyFields(req.metadata, ["client_request_id"], "metadata");
    if (has(req.metadata, "client_request_id")) {
      const id = req.metadata.client_request_id;
      if (typeof id !== "string" || id.length > 200 || /[\/\\\x00\r\n]/.test(id)) throw new Error("invalid metadata.client_request_id");
      out.metadata = { client_request_id: id };
    }
  }
  return out;
}
function base(ctx) {
  const value = String(ctx.baseUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(value)) throw new Error("Configure the API root URL");
  return value;
}
function auth(ctx) {
  if (!ctx.apiKey) throw new Error("Complete the connection settings");
  return { Authorization: "Bearer " + ctx.apiKey };
}
function upstreamId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(value)) throw new Error("video task id is missing or invalid");
  return encodeURIComponent(value);
}
// Responses may cross several installations. Only defined public diagnostics
// and scalar task fields are retained; arbitrary server text is never echoed.
const PUBLIC_DIAGNOSTICS = {
  generation_unavailable: "暂时无法继续处理，请重新提交。",
  input_real_person: "输入图片被识别为可能包含真人，请更换参考图片。",
  input_video_real_person: "参考视频被识别为可能包含真人，本次生成失败，请更换参考视频后重新提交。",
  input_audio_copyright: "参考音频未通过版权检查，请更换音频后重新提交。",
  video_edit_parameters: "当前请求被识别为视频编辑，画幅和时长必须跟随参考视频（4～30秒）。请调整提示词为生成新视频后重新提交。",
  output_audio_copyright: "生成的音频未通过版权检查，请调整音频要求或关闭音频后重试。",
  output_video_copyright: "生成的视频未通过版权检查，请调整提示词或参考素材后重试。",
  input_image_resolution: "参考图片分辨率太低，每张图片总像素至少需要 90000（宽×高），请更换更高清的参考图片后重新提交。",
  input_image_width: "参考图片宽度至少需要 300 像素，请更换清晰图片后重新提交。",
  input_audio_duration: "参考音频时长至少需要 1.8 秒，请更换音频后重新提交。",
  input_image_max_width: "参考图片宽度不能超过 6000 像素，请缩小图片后重新提交。",
  input_audio_total_duration: "所有参考音频的总时长不能超过 30 秒，请裁剪音频后重新提交。",
  input_video_duration: "参考视频时长不能超过 30 秒，请裁剪视频后重新提交。",
  last_frame_conflict: "当前参考模式不支持尾帧与首帧或其他参考图片混用，请调整参考方式后重新提交。",
  output_content_rejected: "生成的视频未通过内容审核，请调整提示词或参考素材后重新提交。",
  reference_access_denied: "参考素材链接不允许直接访问，请直接上传素材，或使用无需登录即可下载的链接后重新提交。",
  reference_not_found: "参考素材链接已失效或文件不存在，请重新上传素材后提交。",
  reference_fetch_failed: "参考素材下载失败，请检查链接是否可访问，或直接上传素材后重新提交。",
  reference_preparation_failed: "参考素材无法读取或校验失败，请检查素材格式、大小或重新上传后提交。",
  task_query_not_found: "未能查到该任务的处理记录，请凭当前任务编号联系管理员。",
  reference_mode_conflict: "首帧／尾帧不能与普通参考素材同时使用，请选择一种模式后重新提交。",
  input_video_resolution: "参考视频分辨率太低，请使用 720P 或更高分辨率的视频。",
  input_aspect_ratio: "参考图片宽高比不符合当前模型要求，请调整图片比例后重试。",
  content_rejected: "输入内容未通过审核，请调整提示词或参考素材。",
  invalid_parameters: "请求参数不符合模型要求，请检查时长、尺寸和参考素材。",
  generation_rejected: "生成请求未被接受，请检查输入或联系管理员。",
  submission_pending: "提交结果正在确认，请继续查询原任务，不要重复提交。",
  status_temporarily_unavailable: "暂时无法查询最新状态，请继续查询原任务。",
  artifact_deleted: "视频已完整交付并删除，无法再次下载。",
  artifact_not_ready: "视频尚未准备好，请稍后再次查询。",
  artifact_unavailable: "生成结果暂不可用，请继续查询原任务或联系管理员，避免重复生成。",
  request_canceled: "请求已取消，请先确认原任务状态，避免重复生成。",
  service_unavailable: "服务暂时不可用，请继续查询已有任务或联系管理员。",
  invalid_media_parameters: "请求参数无效，请检查模型、尺寸、时长及参考素材。",
  invalid_image: "参考素材无法处理，请检查文件格式和大小。",
  origin_not_allowed: "当前访问来源未启用，请联系管理员。",
  invalid_api_key: "连接验证失败，请检查连接设置。",
  request_conflict: "业务请求号已用于其他参数，请先查询原请求。",
  storage_unavailable: "任务存储暂不可用，请使用原业务请求号查询，避免重复生成。",
  media_paused: "新任务提交已暂停，请稍后再试。",
  media_queue_full: "任务队列已满，请稍后再试。",
  media_storage_full: "临时存储已满，请稍后再试。",
  task_not_found: "未找到任务，请检查任务编号及连接设置。",
  request_not_found: "未找到原请求，请检查业务请求号及连接设置。",
  not_found: "未找到任务，请检查任务编号及连接设置。",
  invalid_upload: "素材上传无效，请使用支持的图片、MP4 视频、MP3 或 WAV 音频。",
  video_generation_failed: "视频生成失败，请凭当前任务编号联系管理员。",
};
function diagnostic(code) {
  if (typeof code !== "string") return null;
  // Accept the old public name only as input; never emit it again.
  if (code === "insufficient_balance") code = "generation_unavailable";
  if (!has(PUBLIC_DIAGNOSTICS, code)) return null;
  return { code: code, message: PUBLIC_DIAGNOSTICS[code] };
}
function diagnosticMessage(message) {
  if (typeof message !== "string") return null;
  if (message === "所有参考音频的总时长不能超过 30.2 秒，请裁剪音频后重新提交。") return diagnostic("input_audio_total_duration");
  if (message === "参考视频时长不能超过 30.2 秒，请裁剪视频后重新提交。") return diagnostic("input_video_duration");
  if (message === "可用余额不足，暂时无法继续处理，请联系管理员。" || message === "生成服务可用积分不足，请稍后重试或联系管理员。") return diagnostic("generation_unavailable");
  if (message === "输入图片宽高比不符合模型要求，请调整参考图片。") return diagnostic("input_aspect_ratio");
  for (const code of Object.keys(PUBLIC_DIAGNOSTICS)) {
    if (message === PUBLIC_DIAGNOSTICS[code]) return diagnostic(code);
  }
  return null;
}
function publicDiagnostic(body, fallback, failureReason, taskStatus) {
  body = object(body) ? body : {};
  let selected = null;
  for (const field of ["error", "diagnostic"]) {
    if (object(body[field])) {
      selected = diagnostic(body[field].code) || diagnosticMessage(body[field].message);
      if (selected) break;
    }
  }
  // The host persists the reason returned by parseTaskResult. Recognize only
  // our exact messages when a later view no longer contains the original code.
  selected = selected || diagnosticMessage(failureReason) || diagnostic(fallback || "video_generation_failed");
  if (selected.code === "generation_unavailable") {
    // A relay's authoritative state may be newer than its stored task data.
    // Unknown, active and uncertain tasks must keep their original identity.
    let state = knownStatus(taskStatus === undefined ? body.status : taskStatus);
    const detailState = knownStatus(body.status);
    if (state === "in_progress" && (detailState === "submission_unknown" || detailState === "needs_review")) state = detailState;
    if (state !== "failed") return diagnostic(state === "submission_unknown" || state === "needs_review" ? "submission_pending" : "status_temporarily_unavailable");
  }
  return selected;
}
function reason(body, fallback) {
  return publicDiagnostic(body, fallback).message;
}
const RESULT_STATUS = {
  queued: "QUEUED", pending: "QUEUED", processing: "IN_PROGRESS", in_progress: "IN_PROGRESS",
  query_blocked: "IN_PROGRESS", submission_unknown: "IN_PROGRESS", needs_review: "IN_PROGRESS",
  completed: "SUCCESS", failed: "FAILURE", cancelled: "FAILURE",
};
const VIDEO_STATUS = {
  NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "in_progress",
  SUCCESS: "completed", FAILURE: "failed",
};
function knownStatus(value) {
  if (typeof value !== "string") return undefined;
  if (has(RESULT_STATUS, value)) return value;
  return has(VIDEO_STATUS, value) ? VIDEO_STATUS[value] : undefined;
}
function scalarNumber(value) {
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) value = Number(value);
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
}
function publicTaskData(value, taskStatus) {
  const body = object(value) ? value : {};
  const out = {};
  for (const field of ["created_at", "completed_at", "elapsed_seconds", "downloaded_at", "deleted_at"]) {
    const number = scalarNumber(body[field]);
    if (number !== undefined) out[field] = number;
  }
  const seconds = scalarNumber(body.seconds);
  if (seconds !== undefined && Number.isInteger(seconds) && seconds >= 4 && seconds <= 30) out.seconds = seconds;
  if (typeof body.size === "string" && has(SIZES, body.size)) out.size = body.size;
  if (typeof body.enable_audio === "boolean") out.enable_audio = body.enable_audio;
  for (const field of ["reference_count", "reference_video_count", "reference_audio_count"]) {
    const count = scalarNumber(body[field]);
    if (count !== undefined && Number.isInteger(count) && count <= (field === "reference_count" ? 30 : 10)) out[field] = count;
  }
  if (typeof body.client_request_id === "string" && body.client_request_id.length <= 200 && !/[\/\\\x00\r\n]/.test(body.client_request_id)) out.client_request_id = body.client_request_id;
  if (typeof body.file_status === "string" && ["", "available", "delete_pending", "deleted"].includes(body.file_status)) out.file_status = body.file_status;
  const status = knownStatus(body.status);
  const providerStatus = knownStatus(body.provider_status) || status;
  if (status) out.status = status;
  if (providerStatus) out.provider_status = providerStatus;
  if (object(body.diagnostic) || object(body.error)) {
    const active = status && RESULT_STATUS[status] !== "SUCCESS" && RESULT_STATUS[status] !== "FAILURE";
    const fallback = status === "submission_unknown" || status === "needs_review" ? "submission_pending" : active ? "status_temporarily_unavailable" : "video_generation_failed";
    out.diagnostic = publicDiagnostic(body, fallback, undefined, taskStatus);
  }
  return out;
}

export function buildSubmitRequest(ctx) {
  if (ctx.action === "remix" || (ctx.files || []).length) throw new Error("Use JSON /v1/videos; remix and multipart file submission are not supported");
  // ctx.model is OriginModelName (often the facade). ctx.upstreamModel is the
  // channel model_mapping result. Neither may reject the submit; the JSON
  // body still carries the literal seedance-2.5.
  const names = hostIdentities(ctx);
  const body = normalize(ctx.requestBody, ctx.model || ctx.upstreamModel || MODEL, names);
  ensureRequestSize(body);
  const headers = auth(ctx);
  headers["Content-Type"] = "application/json";
  return { url: base(ctx) + "/v1/videos", method: "POST", headers: headers, body: body };
}
export function parseSubmitResponse(ctx, response) {
  const body = object(response.body) ? response.body : {};
  const id = body.id || body.task_id;
  if (!id) throw new Error(reason(body, "submission_pending"));
  upstreamId(id);
  return { taskId: id, taskData: publicTaskData(body) };
}
export function buildQueryRequest(ctx) {
  return { url: base(ctx) + "/v1/videos/" + upstreamId(ctx.taskId), method: "GET", headers: auth(ctx) };
}
export function parseTaskResult(ctx, body) {
  body = object(body) ? body : {};
  const name = knownStatus(body.status);
  const status = name ? RESULT_STATUS[name] : undefined;
  if (!status) return { status: "UNKNOWN", reason: PUBLIC_DIAGNOSTICS.status_temporarily_unavailable };
  const out = { status: status };
  const progress = scalarNumber(body.progress);
  if (progress !== undefined && progress > 0 && progress < 100) out.progress = progress + "%";
  if (status === "FAILURE") out.reason = reason(body);
  return out;
}
export function extractUsage(ctx) {
  const names = hostIdentities(ctx);
  const req = normalize(ctx.requestBody, (ctx && (ctx.upstreamModel || ctx.model)) || MODEL, names);
  return { seconds: req.seconds, resolution: SIZES[req.size], enable_audio: req.enable_audio };
}
export function extractUsageOnComplete(ctx, result, body) {
  body = object(body) ? body : {};
  const out = {};
  if (body.seconds !== undefined) out.seconds = integerSeconds(body.seconds);
  if (typeof body.size === "string" && has(SIZES, body.size)) out.resolution = SIZES[body.size];
  if (typeof body.enable_audio === "boolean") out.enable_audio = body.enable_audio;
  return out;
}
export function listArtifacts(task) {
  return task.status === "SUCCESS" ? [{ key: "video", type: "video" }] : [];
}
export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const method = String((ctx.clientRequest || {}).method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new Error("Video content supports GET and HEAD only");
  const headers = auth(ctx);
  headers["X-Media-Protocol"] = "openai_video";
  headers["Cache-Control"] = "no-cache, no-store, max-age=0";
  headers["Pragma"] = "no-cache";
  const incoming = (ctx.clientRequest || {}).headers || {};
  const headHints = Object.keys(incoming).filter(name => name.toLowerCase() === "x-media-request-method");
  if (method === "HEAD" || (headHints.length === 1 && incoming[headHints[0]] === "HEAD")) headers["X-Media-Request-Method"] = "HEAD";
  const allowed = { range: "Range", "if-range": "If-Range", "if-none-match": "If-None-Match", "if-modified-since": "If-Modified-Since" };
  for (const name of Object.keys(incoming)) {
    const target = allowed[name.toLowerCase()];
    if (target && typeof incoming[name] === "string") headers[target] = incoming[name];
  }
  return { url: base(ctx) + "/v1/videos/" + upstreamId(ctx.upstreamTaskId) + "/content", method: method, headers: headers };
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("Use JSON /v1/videos with reference_images/reference_videos/reference_audios or first_frame/last_frame; multipart is not supported");
      const pinned = ctx.model;
      if (typeof pinned !== "string" || !pinned) throw new Error("model is required");
      // Repeated calls see the same client body. Return the pin verbatim so
      // resolved == pinned, including facade and app-秒/条 aliases.
      const names = hostIdentities(ctx);
      const req = normalize(ctx.body.value, pinned, names);
      return { kind: "submit", model: pinned, action: (req.reference_videos || []).length || (req.reference_audios || []).length ? "reference_to_video" : (req.reference_images || []).length || req.first_frame || req.last_frame ? "image_to_video" : "text_to_video", requestBody: req };
    },
    render: function (ctx, task) {
      const data = publicTaskData(task.data, task.status);
      const taskStatus = typeof task.status === "string" && has(VIDEO_STATUS, task.status) ? VIDEO_STATUS[task.status] : "unknown";
      const publicId = typeof task.task_id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(task.task_id) ? task.task_id : "";
      const out = {
        id: publicId,
        object: "video",
        // Host overwrites model with OriginModelName. Echo the client model
        // when this render context still has it; otherwise keep the literal.
        model: (ctx && typeof ctx.model === "string" && ctx.model) || ((task.properties || {}).origin_model_name) || MODEL,
        status: taskStatus,
        created_at: scalarNumber(task.created_at) || data.created_at || 0,
      };
      const progress = scalarNumber(typeof task.progress === "string" ? task.progress.replace(/%$/, "") : task.progress === undefined ? 0 : task.progress);
      if (progress !== undefined && progress <= 100) out.progress = progress;
      const fields = ["seconds", "size", "enable_audio", "reference_count", "reference_video_count", "reference_audio_count", "client_request_id", "file_status", "elapsed_seconds", "downloaded_at", "deleted_at"];
      for (const field of fields) if (has(data, field)) out[field] = data[field];
      if (data.provider_status) out.provider_status = data.provider_status;
      if (data.diagnostic) out.diagnostic = data.diagnostic;
      const finished = scalarNumber(task.finished_at) || data.completed_at || 0;
      if (finished > 0) out.completed_at = finished;
      if (task.status === "FAILURE") {
        out.error = publicDiagnostic(task.data, "video_generation_failed", task.fail_reason, task.status);
      }
      // Never return a relative URL containing an upstream/private task id.
      // Download using this NewAPI's /v1/videos/{public id}/content endpoint.
      return out;
    },
  },
};
