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
 * The JSON body is the official sora openai_video body: client fields are
 * forwarded, and model is the upstream model. MegaAi fields (duration, ratio,
 * resolution, seed, referenceImages, referenceVideos, referenceAudios,
 * metadata) are not renamed. Compat fields seconds, size, image, and
 * input_reference are forwarded as well. seconds and duration are only
 * cross-read for the same 1..3600 check sora performs. Multipart follows
 * sora, including copying a lone duration form field onto numeric seconds.
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
  version: "1.0.0",
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

function requestValues(req, model) {
  const values = Object.assign({}, req || {});
  values.model = model;
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
          requestBody: Object.assign({}, req, { model: ctx.model }),
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
        requestBody: Object.assign({}, req, { model: ctx.model }),
      };
    },
    render: function (ctx, task) {
      return legacyRenderers.openai_video(task);
    },
  },
};
