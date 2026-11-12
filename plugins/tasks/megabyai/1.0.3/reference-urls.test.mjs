import assert from "node:assert/strict";

const plugin = await import(new URL("./plugin.js", import.meta.url));

function submit(requestBody) {
  return plugin.buildSubmitRequest({
    action: "video",
    baseUrl: "https://megaviews.top",
    apiKey: "sk-test",
    model: "seedance-2.0-m2",
    upstreamModel: "seedance-2.0-m2",
    requestBody,
  }).body;
}

assert.equal(plugin.meta.version, "1.0.3");
assert.equal(plugin.meta.models.length, 45);
assert.equal(plugin.meta.models[21], "wan3.0-video-prime");
assert.equal(plugin.meta.models[22], "seedance-2.0-fast-m2");
assert.equal(plugin.meta.models.at(-1), "T1-seedance-2.5-720p");

const named = submit({
  prompt: "p",
  seconds: 5,
  images: [
    { name: "hero", url: "https://cdn.example/a.png" },
    { name: "tail", url: "https://cdn.example/b.png", type: "end_frame" },
  ],
});
assert.deepEqual(named.referenceImages, [
  "https://cdn.example/a.png",
  "https://cdn.example/b.png",
]);
assert.equal(named.referenceImages.every((item) => typeof item === "string"), true);
assert.equal(JSON.stringify(named.referenceImages).includes("hero"), false);
assert.equal(named.prompt, "p");
assert.equal(named.seconds, 5);
assert.equal(named.model, "seedance-2.0-m2");

const strings = submit({
  prompt: "p",
  images: ["https://cdn.example/a.png", "https://cdn.example/b.png"],
  videos: ["https://cdn.example/v.mp4"],
  audios: ["https://cdn.example/a.mp3"],
});
assert.deepEqual(strings.referenceImages, ["https://cdn.example/a.png", "https://cdn.example/b.png"]);
assert.deepEqual(strings.referenceVideos, ["https://cdn.example/v.mp4"]);
assert.deepEqual(strings.referenceAudios, ["https://cdn.example/a.mp3"]);

const mixed = submit({
  prompt: "p",
  images: [
    { name: "a", url: "https://cdn.example/a.png" },
    "https://cdn.example/b.png",
    { url: "" },
    { name: "missing" },
    { url: "   " },
    { url: "https://cdn.example/c.png", type: "first_frame" },
    "",
    null,
  ],
  videos: [
    { name: "clip", url: "https://cdn.example/v.mp4" },
    "https://cdn.example/v2.mp4",
    { name: "orphan", asset_id: "vid-1" },
    { url: "" },
  ],
  audios: [
    { name: "voice", url: "https://cdn.example/a.mp3" },
    "https://cdn.example/a2.mp3",
    { name: "silent", fileId: "aud-1" },
    { url: "" },
  ],
});
assert.deepEqual(mixed.referenceImages, [
  "https://cdn.example/a.png",
  "https://cdn.example/b.png",
  "https://cdn.example/c.png",
]);
assert.deepEqual(mixed.referenceVideos, [
  "https://cdn.example/v.mp4",
  "https://cdn.example/v2.mp4",
]);
assert.deepEqual(mixed.referenceAudios, [
  "https://cdn.example/a.mp3",
  "https://cdn.example/a2.mp3",
]);
for (const key of ["referenceImages", "referenceVideos", "referenceAudios"]) {
  assert.equal(mixed[key].every((item) => typeof item === "string"), true);
  assert.equal(JSON.stringify(mixed[key]).includes("name"), false);
}
assert.equal(JSON.stringify(mixed).includes("vid-1"), false);
assert.equal(JSON.stringify(mixed).includes("aud-1"), false);

const dropped = submit({
  prompt: "p",
  images: [{ name: "only-name" }, { name: "id", fileId: "abc" }, { url: "" }],
  videos: [{ name: "v", asset_id: "vid-only" }],
  audios: [{ name: "a", fileId: "aud-only" }],
});
assert.equal(dropped.referenceImages, undefined);
assert.equal(dropped.referenceVideos, undefined);
assert.equal(dropped.referenceAudios, undefined);
assert.equal(JSON.stringify(dropped).includes("only-name"), false);
assert.equal(JSON.stringify(dropped).includes("abc"), false);
assert.equal(JSON.stringify(dropped).includes("vid-only"), false);

const none = submit({ prompt: "p", ratio: "16:9" });
assert.equal(none.referenceImages, undefined);
assert.equal(none.referenceVideos, undefined);
assert.equal(none.referenceAudios, undefined);
assert.equal(none.ratio, "16:9");

console.log("megabyai 1.0.3 reference urls ok");
