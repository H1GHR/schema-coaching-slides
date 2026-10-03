const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { Script, runInNewContext } = require('node:vm');
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
  assert.match(html, /src="assets\/video\/schema-video.js\?v=question-frame-20261003"/);
  assert.match(html, /href="assets\/video\/schema-video.css\?v=center-controls-20261003"/);
  assert.doesNotMatch(html, /youtube.com\/iframe_api|new YT.Player|const before = document.querySelector\('.concept-slide-7'\)/);
  for (const [, source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new Script(source);
  const source = readFileSync(`${__dirname}/schema-video.js`, 'utf8');
  assert.match(source, /media\/schema-film-final-1080p.mp4/);
  assert.doesNotMatch(source, /fetch\(|iframe|slides\[7\]/);
  for (const copy of ['영상이 질문 화면에서 멈췄어요.', '이어서 보기', '출연진: 필재', 'CC BY 4.0']) assert.ok(source.includes(copy));
  assert.doesNotMatch(source, /role="dialog"|aria-modal="true"|class="lesson-question"/);
});

function mountedFixture() {
  const document = { hidden: false, activeElement: null };
  class Element extends Video {
    constructor(tag) {
      super();
      this.tagName = tag;
      this.children = [];
      this.attributes = new Map();
      this.dataset = {};
      this.hidden = this.inert = this.disabled = false;
      this.textContent = '';
      this.classList = { add: value => this.setAttribute('class', `${this.getAttribute('class') || ''} ${value}`) };
    }
    setAttribute(name, value) {
      this.attributes.set(name, value);
      if (['hidden', 'inert', 'disabled'].includes(name)) this[name] = true;
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    append(child) { child.parentElement = this; this.children.push(child); }
    contains(child) { return child === this || this.children.some(item => item.contains(child)); }
    get hidden() { return this._hidden; }
    set hidden(value) {
      this._hidden = value;
      if (value && this.contains(document.activeElement)) document.activeElement = null;
    }
    querySelectorAll(selector) {
      const matches = item => selector.startsWith('.')
        ? (item.getAttribute('class') || '').split(/\s+/).includes(selector.slice(1))
        : item.tagName === selector;
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    blocked() {
      for (let item = this; item; item = item.parentElement) if (item.hidden || item.inert || item.disabled) return true;
      return false;
    }
    focus() { if (!this.blocked()) document.activeElement = this; }
    click() {
      if (this.blocked()) return Promise.resolve();
      return Promise.resolve(this.listeners.get('click')?.({ currentTarget: this }));
    }
    set innerHTML(markup) {
      this.children = [];
      const stack = [this];
      for (const token of markup.match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (!token.startsWith('<')) { stack.at(-1).textContent += token; continue; }
        const tag = token.match(/^<([a-z][\w-]*)/i)?.[1];
        assert.ok(tag, 'minimal DOM fixture supports only the emitted element markup');
        const child = new Element(tag);
        const attributes = token.slice(tag.length + 1, -1);
        for (const match of attributes.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) child.setAttribute(match[1], match[2] ?? '');
        stack.at(-1).append(child);
        if (!['input', 'br', 'img', 'source'].includes(tag)) stack.push(child);
      }
      assert.equal(stack.length, 1, 'emitted markup must have balanced elements');
    }
  }
  const body = new Element('body');
  for (let index = 0; index < 4; index++) {
    const preceding = new Element('section');
    preceding.setAttribute('class', 'slide');
    preceding.setAttribute('aria-label', `${index + 1}. preceding`);
    body.append(preceding);
  }
  const slide = new Element('section');
  slide.setAttribute('class', 'slide video-slide');
  slide.setAttribute('aria-label', '5. 영상');
  body.append(slide);
  document.querySelector = selector => body.querySelector(selector);
  document.querySelectorAll = selector => body.querySelectorAll(selector);
  const context = { document };
  runInNewContext(readFileSync(`${__dirname}/schema-video.js`, 'utf8'), context);
  context.schemaVideos.install();
  context.schemaVideos.activate(slide);
  const $ = selector => slide.querySelector(selector);
  return { document, slide, $, videos: context.schemaVideos, previous: body.children[3] };
}

test('installed question state keeps the video visible and enables focused resume in the controls', async () => {
  const { document, slide, $ } = mountedFixture();
  const video = $('.lesson-film');
  const controls = $('.lesson-film-controls');
  const resume = $('.lesson-continue');
  const play = $('.lesson-play');
  const seek = $('.lesson-seek');
  assert.equal($('.lesson-question'), null);
  assert.equal(slide.querySelector('section'), null);
  assert.equal(controls.contains(resume), true);
  assert.equal($('.lesson-slide-number').textContent, '05');
  assert.equal(resume.hidden, true);
  video.emit('loadedmetadata');
  await play.click();
  video.currentTime = 45.8;
  video.emit('timeupdate');
  assert.equal(video.currentTime, PAUSE_AT);
  assert.equal(video.paused, true);
  assert.equal(video.hidden, false);
  assert.equal($('.lesson-film-message').hidden, true);
  assert.equal(slide.dataset.videoState, 'question');
  assert.equal(controls.inert, false);
  assert.equal(resume.hidden, false);
  assert.equal(resume.disabled, false);
  assert.equal(document.activeElement, resume);
  assert.equal(seek.disabled, true);
  assert.equal(play.hidden, true);
  await resume.click();
  assert.equal(video.paused, false);
  assert.equal(resume.hidden, true);
  assert.equal(play.hidden, false);
  assert.equal(seek.disabled, false);
  assert.equal(document.activeElement, play);
  video.currentTime = 50;
  video.emit('timeupdate');
  assert.equal(slide.dataset.videoState, 'playing');
});

test('sidebar restart and slide reentry preserve the one-question-per-run contract', async () => {
  const { slide, $, videos, previous } = mountedFixture();
  const video = $('.lesson-film');
  await $('.lesson-play').click();
  video.currentTime = 46;
  video.emit('timeupdate');
  assert.equal($('.lesson-restart').blocked(), false);
  await $('.lesson-restart').click();
  assert.equal(video.currentTime, 0);
  assert.equal(video.paused, false);
  assert.equal($('.lesson-continue').hidden, true);
  video.currentTime = 46;
  video.emit('timeupdate');
  assert.equal(slide.dataset.videoState, 'question');
  videos.activate(previous);
  assert.equal(video.paused, true);
  videos.activate(slide);
  assert.equal(video.paused, true);
  assert.equal($('.lesson-continue').hidden, false);
  await $('.lesson-continue').click();
  assert.equal(video.paused, false);
});
