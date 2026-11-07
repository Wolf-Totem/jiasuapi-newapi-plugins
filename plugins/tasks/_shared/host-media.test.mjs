import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const root = new URL("../../..", import.meta.url);
function plugin(rel) {
  return import(new URL(rel, root));
}

const snippet = readFileSync(new URL("./collect-host-media.js", import.meta.url), "utf8");
const collect = new Function(snippet + "\nreturn { collectHostMedia, applyHostMediaAliases };")();

const media = collect.collectHostMedia({
  images: [{ url: "https://cdn.example/a.png", type: "first_frame" }],
  audios: ["https://cdn.example/a.mp3"],
  reference_image_urls: ["https://cdn.example/b.png"],
});
assert.deepEqual(media.images.map((item) => item.url), ["https://cdn.example/a.png", "https://cdn.example/b.png"]);
assert.equal(media.images[0].type, "first_frame");
assert.deepEqual(media.audios.map((item) => item.url), ["https://cdn.example/a.mp3"]);

const mega = await plugin("plugins/tasks/megabyai/1.0.1/plugin.js");
const megaBody = mega.buildSubmitRequest({
  action: "video",
  baseUrl: "https://megaviews.top",
  apiKey: "sk-test",
  model: "sd-2.0",
  upstreamModel: "sd-2.0",
  requestBody: {
    prompt: "p",
    seconds: 5,
    images: ["https://cdn.example/a.png"],
    audios: ["https://cdn.example/a.mp3"],
    secret_field: "nope",
  },
}).body;
assert.equal(megaBody.secret_field, undefined);
assert.equal(megaBody.images, undefined);
assert.deepEqual(megaBody.referenceImages, ["https://cdn.example/a.png"]);
assert.deepEqual(megaBody.referenceAudios, ["https://cdn.example/a.mp3"]);

const niney = await plugin("plugins/tasks/niney/1.0.1/plugin.js");
assert.throws(
  () => niney.buildSubmitRequest({
    action: "video",
    baseUrl: "https://9yapi.shop",
    apiKey: "sk",
    model: "DB-SD-2.5",
    upstreamModel: "DB-SD-2.5",
    requestBody: { prompt: "p", videos: ["https://cdn.example/v.mp4"] },
  }),
  /reference videos/,
);
const nineyBody = niney.buildSubmitRequest({
  action: "video",
  baseUrl: "https://9yapi.shop",
  apiKey: "sk",
  model: "DB-SD-2.5",
  upstreamModel: "DB-SD-2.5",
  requestBody: {
    prompt: "p",
    images: ["https://cdn.example/a.png"],
    reference_image_urls: ["https://cdn.example/b.png"],
  },
}).body;
assert.deepEqual(nineyBody.reference_images, ["https://cdn.example/a.png", "https://cdn.example/b.png"]);

const jiasu = await plugin("plugins/tasks/jiasuapi/1.0.3/plugin.js");
const jiasuBody = jiasu.buildSubmitRequest({
  action: "video",
  baseUrl: "https://ai.jiasuapi.com",
  apiKey: "sk",
  model: "seedance-2.5-101010",
  upstreamModel: "seedance-2.5-101010",
  requestBody: {
    prompt: "p",
    reference_image_urls: ["https://cdn.example/a.png"],
    reference_audios: ["https://cdn.example/a.mp3"],
  },
}).body;
assert.deepEqual(jiasuBody.images, ["https://cdn.example/a.png"]);
assert.deepEqual(jiasuBody.audios, ["https://cdn.example/a.mp3"]);

console.log("host-media.test.mjs ok");
