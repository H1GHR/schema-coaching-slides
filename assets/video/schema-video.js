(function (scope) {
  'use strict';
  const PAUSE_AT = 1361 / 30;
  const DURATION = 168.9;

  class SchemaLocalController {
    constructor(video, report) {
      this.video = video;
      this.report = report;
      this.active = false;
      this.asked = false;
      this.question = false;
      this.failed = false;
      this.started = false;
      this.phase = 'idle';
      video.addEventListener('loadedmetadata', () => {
        if (Math.abs(video.duration - DURATION) > 0.15) {
          this.failed = true;
          video.pause();
          this.emit('error', '영상 길이가 맞지 않아요. 최종 영상 파일을 확인해 주세요.');
        } else this.emit(this.started ? 'paused' : 'idle');
      });
      video.addEventListener('play', () => {
        if (!this.active || this.question || this.failed) video.pause();
        else { this.started = true; this.emit('playing'); }
      });
      video.addEventListener('pause', () => {
        if (!this.question && !this.failed && !video.ended) this.emit('paused');
      });
      video.addEventListener('timeupdate', () => this.tick());
      video.addEventListener('seeked', () => this.tick());
      video.addEventListener('waiting', () => {
        if (!this.question && this.active && !this.failed) this.emit('loading');
      });
      video.addEventListener('playing', () => {
        if (this.active && !this.question && !this.failed) this.emit('playing');
      });
      video.addEventListener('ended', () => {
        if (!this.tick()) this.emit('ended');
      });
      video.addEventListener('error', () => {
        this.failed = true;
        video.pause();
        this.emit('error', '영상을 열 수 없어요. media 폴더의 최종 MP4를 확인해 주세요.');
      });
      if (typeof video.requestVideoFrameCallback === 'function') {
        const next = (_now, metadata) => {
          this.tick(metadata.mediaTime);
          video.requestVideoFrameCallback(next);
        };
        video.requestVideoFrameCallback(next);
      }
    }
    emit(phase, message = '') {
      this.phase = phase;
      this.report(phase, this.video.currentTime || 0, message);
    }
    tick(time = this.video.currentTime) {
      if (!this.active || this.failed || this.video.seeking) return false;
      if (!this.asked && Number.isFinite(time) && time >= PAUSE_AT) {
        this.asked = true;
        this.question = true;
        this.video.pause();
        this.video.currentTime = PAUSE_AT;
        this.emit('question');
        return true;
      }
      if (!this.question) this.emit(!this.started ? 'idle' : this.video.ended ? 'ended' : this.video.paused ? 'paused' : 'playing');
      return this.question;
    }
    async play() {
      if (!this.active || this.failed) return;
      this.question = false;
      this.emit('loading');
      try {
        await this.video.play();
        if (!this.active || this.question) this.video.pause();
      } catch {
        if (this.active && !this.failed && !this.question) this.emit('paused', '재생 버튼을 다시 눌러 주세요.');
      }
    }
    toggle() {
      if (!this.active || this.question || this.failed) return;
      if (this.video.ended) return this.restart();
      if (this.video.paused) return this.play();
      this.video.pause();
    }
    restart() {
      if (!this.active || this.failed) return;
      this.asked = false;
      this.question = false;
      this.video.currentTime = 0;
      return this.play();
    }
    seek(time) {
      if (!this.active || this.question || this.failed || !Number.isFinite(time)) return;
      this.video.currentTime = Math.max(0, Math.min(DURATION, time));
      this.tick();
    }
    setActive(active) {
      this.active = active;
      if (!active) this.video.pause();
    }
  }

  scope.SchemaLocalController = SchemaLocalController;
  if (typeof module !== 'undefined') module.exports = { SchemaLocalController, PAUSE_AT, DURATION };
  if (typeof document === 'undefined') return;

  const clock = time => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
  let instance;
  scope.schemaVideos = {
    install() {
      const slide = document.querySelector('.video-slide');
      slide.classList.add('local-film-slide');
      slide.dataset.title = '같은 장면, 다른 생각.';
      slide.innerHTML = `<header class="slide-header"><h1>같은 장면, 다른 생각.</h1></header>
        <div class="lesson-film-stage">
          <video class="lesson-film" src="media/schema-film-final-1080p.mp4" preload="metadata" playsinline aria-label="같은 장면, 다른 생각" tabindex="0"></video>
          <p class="lesson-film-message">재생을 누르면 영상이 시작돼요.</p>
        </div>
        <div class="lesson-film-controls" aria-label="영상 조작">
          <button class="lesson-continue primary" type="button" hidden>이어서 보기</button>
          <button class="lesson-play primary" type="button">재생</button>
          <button class="lesson-restart" type="button">처음부터</button>
          <input class="lesson-seek" type="range" min="0" max="168.9" step="0.0333333333" value="0" aria-label="영상 재생 위치">
          <output class="lesson-clock">0:00 / 2:48</output>
          <button class="lesson-mute" type="button" aria-pressed="false">소리 끄기</button>
          <p class="lesson-status" role="status" aria-live="polite"></p>
        </div>
        <footer class="video-footer"><div class="lesson-credit">
          <div>이 콘텐츠는 인공지능 가상 연기자 서비스, 타입캐스트를 활용하여 제작되었습니다. 출연진: 필재 · <a href="https://typecast.ai/kr" target="_blank" rel="noopener">typecast.ai/kr</a></div>
          <div>BGM: <a href="https://incompetech.com/music/royalty-free/index.html?Search=Search&amp;isrc=USUAN1400011" target="_blank" rel="noopener">Monkeys Spinning Monkeys — Kevin MacLeod (incompetech.com)</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> · 편집·반복·음량·페이드 조정</div>
          <div>글꼴: 양진체(김양진) · 미생체(윤태호·카카오·산돌) · Pretendard(길형진)</div>
        </div><span class="lesson-slide-number"></span></footer>`;
      const $ = selector => slide.querySelector(selector);
      const video = $('.lesson-film');
      const play = $('.lesson-play');
      const seek = $('.lesson-seek');
      const resume = $('.lesson-continue');
      const status = $('.lesson-status');
      let previousPhase = 'idle';
      const controller = new SchemaLocalController(video, (phase, time, message) => {
        const changed = phase !== previousPhase;
        const resumeHadFocus = document.activeElement === resume;
        previousPhase = phase;
        slide.dataset.videoState = phase;
        resume.hidden = phase !== 'question';
        play.hidden = phase === 'question';
        video.inert = phase === 'question';
        play.disabled = seek.disabled = phase === 'question' || phase === 'error';
        $('.lesson-restart').disabled = phase === 'error';
        $('.lesson-clock').textContent = `${clock(time)} / ${clock(DURATION)}`;
        seek.value = String(time);
        seek.setAttribute('aria-valuetext', `${clock(time)} / ${clock(DURATION)}`);
        play.textContent = phase === 'playing' || phase === 'loading' ? '일시정지' : phase === 'ended' ? '다시 보기' : '재생';
        const note = $('.lesson-film-message');
        note.hidden = !['idle', 'error'].includes(phase);
        if (phase === 'error') note.textContent = message;
        const statusText = message || ({question: '영상이 질문 화면에서 멈췄어요. 나는 어떤 생각이 먼저 들었나요? 화났나, 급한가, 못 봤나, 다른 생각, 모르겠어 중 하나를 채팅에 보내거나 패스해도 괜찮아요. 생각을 나눈 뒤 이어서 보세요.', loading: '영상을 불러오는 중이에요.', ended: '영상을 모두 봤어요.'}[phase] || '');
        if (status.textContent !== statusText) status.textContent = statusText;
        if (changed && phase === 'question' && controller.active) resume.focus({ preventScroll: true });
        else if (changed && phase !== 'question' && resumeHadFocus) play.focus({ preventScroll: true });
      });
      play.addEventListener('click', () => controller.toggle());
      $('.lesson-restart').addEventListener('click', () => controller.restart());
      resume.addEventListener('click', () => controller.play());
      seek.addEventListener('input', () => controller.seek(Number(seek.value)));
      $('.lesson-mute').addEventListener('click', event => {
        video.muted = !video.muted;
        event.currentTarget.setAttribute('aria-pressed', String(video.muted));
        event.currentTarget.textContent = video.muted ? '소리 켜기' : '소리 끄기';
      });
      video.addEventListener('click', () => controller.toggle());
      video.addEventListener('keydown', event => {
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); controller.toggle(); }
        event.stopPropagation();
      });
      instance = { slide, controller };
      return [...document.querySelectorAll('.slide')].map((item, index) => {
        const title = item.dataset.title || item.getAttribute('aria-label').replace(/^\d+\.\s*/, '');
        item.setAttribute('aria-label', `${index + 1}. ${title}`);
        if (item === slide) $('.lesson-slide-number').textContent = String(index + 1).padStart(2, '0');
        return { title };
      });
    },
    activate(slide) { instance?.controller.setActive(instance.slide === slide && !document.hidden); },
    pauseAll() { instance?.controller.setActive(false); },
    tick() { instance?.controller.tick(); },
  };
})(globalThis);
