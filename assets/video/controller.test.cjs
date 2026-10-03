const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { Script } = require('node:vm');
const { SchemaLocalController, PAUSE_AT, DURATION } = require('./schema-video.js');

class Video {
  listeners = new Map();
  currentTime = 0;
  duration = DURATION;
  paused = true;
  seeking = false;
  ended = false;
  plays = 0;
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  emit(name) { this.listeners.get(name)?.(); }
  play() { this.plays++; this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
}
function fixture() {
  const video = new Video();
  const reports = [];
  const controller = new SchemaLocalController(video, (...args) => reports.push(args));
  controller.setActive(true);
  return { video, controller, reports };
}

test('local metadata loads without autoplay and retains the idle start state', () => {
  const { video, controller } = fixture();
  video.emit('loadedmetadata');
  controller.tick();
  assert.equal(video.plays, 0);
  assert.equal(controller.phase, 'idle');
});

test('crossing 1361/30 pauses at the exact question frame once', async () => {
  const { video, controller, reports } = fixture();
  await controller.play();
  video.currentTime = 45.8;
  video.emit('timeupdate');
  assert.equal(video.currentTime, PAUSE_AT);
  assert.equal(video.paused, true);
  assert.equal(controller.question, true);
  await controller.play();
  video.currentTime = 50;
  video.emit('timeupdate');
  assert.equal(video.paused, false);
  assert.equal(reports.filter(([phase]) => phase === 'question').length, 1);
});

test('forward seeking cannot skip the first question; later seeks do not repeat it', async () => {
  const { video, controller, reports } = fixture();
  controller.seek(90);
  assert.equal(video.currentTime, PAUSE_AT);
  assert.equal(controller.question, true);
  controller.seek(0);
  assert.equal(video.currentTime, PAUSE_AT);
  await controller.play();
  controller.seek(10);
  controller.seek(100);
  assert.equal(video.currentTime, 100);
  assert.equal(reports.filter(([phase]) => phase === 'question').length, 1);
});

test('seeked event checks the settled time, and restart rearms the question', async () => {
  const { video, controller } = fixture();
  video.seeking = true;
  controller.seek(100);
  assert.equal(controller.question, false);
  video.seeking = false;
  video.emit('seeked');
  assert.equal(controller.question, true);
  await controller.restart();
  assert.equal(video.currentTime, 0);
  assert.equal(controller.asked, false);
  video.currentTime = 46;
  video.emit('timeupdate');
  assert.equal(controller.question, true);
});

test('leaving the slide pauses and blocks delayed playback; returning never autoplays', async () => {
  const { video, controller } = fixture();
  await controller.play();
  controller.setActive(false);
  assert.equal(video.paused, true);
  await video.play();
  assert.equal(video.paused, true);
  controller.setActive(true);
  assert.equal(video.paused, true);
  video.currentTime = 46;
  controller.tick();
  controller.setActive(false);
  controller.setActive(true);
  assert.equal(controller.question, true);
});

test('play promise resolving after slide exit cannot resume hidden video', async () => {
  const { video, controller } = fixture();
  let resolve;
  video.play = () => new Promise(done => { resolve = done; });
  const pending = controller.play();
  controller.setActive(false);
  video.paused = false;
  resolve();
  await pending;
  assert.equal(video.paused, true);
});

test('wrong duration, media errors, and rejected playback stay safe and report recovery', async () => {
  const invalid = fixture();
  invalid.video.duration = 20;
  invalid.video.emit('loadedmetadata');
  assert.equal(invalid.controller.phase, 'error');
  await invalid.controller.play();
  assert.equal(invalid.video.plays, 0);
  const missing = fixture();
  missing.video.emit('error');
  assert.equal(missing.controller.phase, 'error');
  assert.match(missing.reports.at(-1)[2], /media/);
  const denied = fixture();
  denied.video.play = () => Promise.reject(new Error('blocked'));
  await denied.controller.play();
  assert.equal(denied.controller.phase, 'paused');
  assert.match(denied.reports.at(-1)[2], /다시/);
});

test('a play request aborted by the question pause cannot hide the question', async () => {
  const { video, controller } = fixture();
  let reject;
  video.play = () => new Promise((_resolve, fail) => { reject = fail; });
  const pending = controller.play();
  video.currentTime = 90;
  controller.tick();
  reject(new Error('AbortError: playback was paused'));
  await pending;
  assert.equal(controller.phase, 'question');
  assert.equal(controller.question, true);
  assert.equal(video.currentTime, PAUSE_AT);
});

test('deck uses local classic assets and no YouTube iframe controller', () => {
  const html = readFileSync(`${__dirname}/../../index.html`, 'utf8');
  assert.match(html, /src="assets\/video\/schema-video.js"/);
  assert.match(html, /href="assets\/video\/schema-video.css"/);
  assert.doesNotMatch(html, /youtube.com\/iframe_api|new YT.Player|const before = document.querySelector\('.concept-slide-7'\)/);
  for (const [, source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new Script(source);
  const source = readFileSync(`${__dirname}/schema-video.js`, 'utf8');
  assert.match(source, /media\/schema-film-final-1080p.mp4/);
  assert.doesNotMatch(source, /fetch\(|iframe|slides\[7\]/);
  for (const copy of ['준이가 대답 없이 지나갔어요.', '나는 어떤 생각이 먼저 들었나요?', '😟 화났나?', '🏃 급한가?', '👀 못 봤나?', '❓ 다른 생각·모르겠어요', '출연진: 필재', 'CC BY 4.0']) assert.ok(source.includes(copy));
});
