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
