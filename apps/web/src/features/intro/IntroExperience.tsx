import './intro.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { BRAND } from '@/brand';
import { Lockup, LogoMark } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { forgetSkip, rememberSkip, skipRemembered } from '@/features/intro/skip';
import { introSound } from '@/features/intro/sound';
import {
  CAPTIONS,
  CHAPTERS,
  clamp,
  D_FUSE,
  FLARE,
  HOTSPOTS,
  intro,
  type IntroMode,
  parseSeek,
  sm,
  T_HERO,
} from '@/features/intro/runtime';
import { veil } from '@/scene/veil';
import { useAppStore } from '@/store/app';

const LOADER_TIMEOUT_MS = 12_000;
const SC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·/<>';

/** Prototype caption scramble: random glyphs resolve left to right over 650 ms. */
function scramble(el: HTMLElement): void {
  const o = el.dataset.o ?? (el.dataset.o = el.textContent ?? '');
  const s0 = performance.now();
  const step = (now: number) => {
    const p = clamp((now - s0) / 650, 0, 1);
    el.textContent = o
      .split('')
      .map((ch, i) => (ch === ' ' || p > i / o.length ? ch : SC[(Math.random() * SC.length) | 0]))
      .join('');
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

type UiState = { mode: IntroMode; hero: boolean; playing: boolean; autoRot: boolean; hsSel: number };
const snapshot = (): UiState => ({
  mode: intro.mode,
  hero: intro.hero,
  playing: intro.playing,
  autoRot: intro.autoRot,
  hsSel: intro.hsSel,
});

/**
 * The cinematic intro overlay (docs/05 §1): loader, letterbox, vignette, grain, captions, HUD,
 * lens flare, chapter track, skip/sound, hero + explore with hotspots. The 3D lives in the
 * persistent Stage; both read `intro` (features/intro/runtime). Per-frame DOM writes go through
 * refs in the runtime's `frame` event; React re-renders only on mode changes.
 */
export function IntroExperience() {
  const navigate = useNavigate();
  const quality = useAppStore((s) => s.quality);
  const [ui, setUi] = useState<UiState>(snapshot);
  const [loaderOff, setLoaderOff] = useState(false);
  const [ctaPop, setCtaPop] = useState(false);
  const [soundOn, setSoundOn] = useState(introSound.on);

  const capRefs = useRef<(HTMLDivElement | null)[]>([]);
  const capDone = useRef<boolean[]>(CAPTIONS.map(() => false));
  const hudRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const chapRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const flareRefs = useRef<(HTMLElement | null)[]>([]);
  const flareWrap = useRef<HTMLDivElement>(null);
  const hotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hcardRef = useRef<HTMLDivElement>(null);

  const goStory = useCallback(() => {
    const go = () => {
      const s = useAppStore.getState();
      s.hydrate({ mode: 'story', act: 1 });
      s.setStageScene('mellegue');
      introSound.stop();
      navigate('/story/1');
    };
    // reduced motion: a 300 ms crossfade cut instead of the flight
    if (useAppStore.getState().reducedMotion) veil.cut(go);
    else go();
  }, [navigate]);

  const skip = useCallback(() => {
    rememberSkip();
    goStory();
  }, [goStory]);

  // (re)start the runtime when the route mounts
  useEffect(() => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    if (params.get('intro') === '1') forgetSkip();
    const seek = parseSeek(search);
    if (!seek && params.get('intro') !== '1' && skipRemembered()) {
      goStory();
      return;
    }
    intro.reset(seek, useAppStore.getState().reducedMotion);
    introSound.reset();
    capDone.current = CAPTIONS.map(() => false);
    setUi(snapshot());
    setLoaderOff(false);
    setCtaPop(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const begin = () => {
      clearTimeout(timer);
      setLoaderOff(true);
      intro.start();
    };
    const offReady = intro.on('ready', begin);
    if (intro.ready) begin();
    else timer = setTimeout(begin, LOADER_TIMEOUT_MS);
    return () => {
      offReady();
      clearTimeout(timer);
    };
  }, [goStory]);

  // 2D fallback: no Stage → no cinematic
  useEffect(() => {
    if (quality === '2d' && intro.mode !== 'explore') {
      setLoaderOff(true);
      intro.start();
      intro.enterHero();
    }
  }, [quality]);

  // mode changes → React; dive end → Act 1
  useEffect(() => {
    const offMode = intro.on('mode', () => setUi(snapshot()));
    const offEnd = intro.on('diveEnd', () => {
      if (!intro.frozen) goStory();
    });
    return () => {
      offMode();
      offEnd();
    };
  }, [goStory]);

  // prefetch the Act route chunk so the dive's navigation is instant
  useEffect(() => {
    if (ui.mode === 'explore') void import('@/routes/Story');
  }, [ui.mode]);

  useEffect(() => {
    if (ui.mode !== 'explore' || !ui.hero) {
      setCtaPop(false);
      return;
    }
    const id = setTimeout(() => setCtaPop(true), intro.frozen ? 0 : 700);
    return () => clearTimeout(id);
  }, [ui.mode, ui.hero]);

  // per-frame DOM writes
  useEffect(() => {
    const w = () => window.innerWidth;
    const h = () => window.innerHeight;
    return intro.on('frame', () => {
      const mode = intro.mode;
      const tl = mode === 'dive' || mode === 'done' ? 'dive' : 'intro';
      const tt = tl === 'dive' ? intro.td : intro.t;
      const showCaps = mode === 'intro' || mode === 'dive';
      CAPTIONS.forEach((c, i) => {
        const el = capRefs.current[i];
        if (!el) return;
        if (c.tl !== tl || !showCaps) {
          el.style.opacity = '0';
          capDone.current[i] = false;
          return;
        }
        const a = Math.min(sm(c.s, c.s + 0.5, tt), 1 - sm(c.e - 0.5, c.e, tt));
        el.style.opacity = String(a);
        el.style.transform = `translateY(${(1 - a) * 10}px)`;
        if (tt < c.s) capDone.current[i] = false;
        if (a > 0.05 && !capDone.current[i]) {
          capDone.current[i] = true;
          if (!intro.reduced && !intro.frozen) el.querySelectorAll<HTMLElement>('.sc').forEach(scramble);
        }
      });
      const hudOn =
        (mode === 'intro' && intro.t > 9.6 && intro.t < T_HERO - 0.3) || (mode === 'dive' && intro.td < D_FUSE);
      hudRef.current?.classList.toggle('on', hudOn);
      if (mode === 'intro' && fillRef.current) {
        fillRef.current.style.transform = `scaleX(${clamp(intro.t / T_HERO, 0, 1)})`;
        CHAPTERS.forEach((ch, i) => chapRefs.current[i]?.classList.toggle('on', intro.t >= ch.s));
      }
      const fl = mode === 'intro' || mode === 'dive' || mode === 'explore';
      if (flareWrap.current) flareWrap.current.style.display = fl ? '' : 'none';
      FLARE.forEach((_, k) => {
        const el = flareRefs.current[k];
        if (!el) return;
        el.style.left = `${intro.flareX[k]}px`;
        el.style.top = `${intro.flareY[k]}px`;
        el.style.opacity = String(intro.flareA);
      });
      if (mode === 'explore') {
        HOTSPOTS.forEach((_, i) => {
          const b = hotRefs.current[i];
          if (!b) return;
          b.style.display = intro.hotVis[i] ? 'flex' : 'none';
          b.style.transform = `translate(${intro.hotX[i]}px, ${intro.hotY[i]}px)`;
          if (intro.hsSel === i && hcardRef.current) {
            hcardRef.current.style.left = `${clamp(intro.hotX[i]! + 22, 10, w() - 300)}px`;
            hcardRef.current.style.top = `${clamp(intro.hotY[i]! - 30, 10, h() - 170)}px`;
          }
        });
      }
      introSound.update(tl === 'dive' ? intro.td : intro.t, mode);
    });
  }, []);

  // keyboard: Space play/pause, Esc skip
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && intro.mode === 'intro') {
        const t = e.target as HTMLElement | null;
        if (t && /^(BUTTON|INPUT|TEXTAREA|A)$/.test(t.tagName)) return;
        e.preventDefault();
        intro.togglePlay();
      } else if (e.key === 'Escape' && intro.mode !== 'dive' && intro.mode !== 'done') {
        e.preventDefault();
        skip();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (intro.mode === 'explore' && !(e.target as HTMLElement).closest('.ix-hs,.ix-hcard') && intro.hsSel >= 0) {
        intro.hsSel = -1;
        setUi(snapshot());
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [skip]);

  const startMission = () => {
    introSound.reset();
    if (intro.reduced) goStory();
    else intro.startMission();
  };

  const { mode, hero } = ui;
  const cine = mode === 'intro' || mode === 'dive' || mode === 'done' || mode === 'loading';
  const explore = mode === 'explore';
  const sel = ui.hsSel >= 0 ? HOTSPOTS[ui.hsSel] : undefined;

  return (
    <div className={`ix-root${cine ? '' : ' bars-off'}`}>
      {!explore || !hero ? <h1 className="sr-only">{BRAND.product}: NISAR, the radar satellite</h1> : null}

      <div ref={flareWrap} className="ix-flare" aria-hidden>
        {FLARE.map((f, k) => (
          <i
            key={k}
            ref={(el) => {
              flareRefs.current[k] = el;
            }}
            style={{ width: f[1], height: f[1], background: `radial-gradient(circle,${f[2]},transparent 70%)`, opacity: 0 }}
          />
        ))}
      </div>
      <div className="ix-vignette" aria-hidden />
      <div className="ix-bar top" aria-hidden />
      <div className="ix-bar bot" aria-hidden />

      <div className="ix-captions" aria-live="polite" style={{ display: cine ? '' : 'none' }}>
        {CAPTIONS.map((c, i) => (
          <div
            key={i}
            className="ix-cap"
            ref={(el) => {
              capRefs.current[i] = el;
            }}
          >
            {c.kicker ? <div className="k">{c.kicker}</div> : null}
            {c.big ? <div className="big sc">{c.big}</div> : null}
            {c.mid ? <div className="mid sc">{c.mid}</div> : null}
            {c.sub ? <div className="sub">{c.sub}</div> : null}
          </div>
        ))}
      </div>

      <div ref={hudRef} className="ix-hud" aria-hidden>
        <div className="ret" />
        <div className="tl">{'ALT  747 KM\nVEL  7.46 KM/S\nORBIT SUN-SYNC\nMODE L-SAR · SWEEPSAR'}</div>
        <div className="tr">{'FREQ 1.257 GHZ\nPOL  HH / HV\nSWATH 242 KM\nTARGET 36.31°N 8.70°E · MELLÈGUE DAM'}</div>
      </div>

      {cine || explore ? (
        <Button
          className="ix-sound"
          aria-pressed={soundOn}
          onClick={() => setSoundOn(introSound.toggle())}
        >
          ♪ Sound {soundOn ? 'on' : 'off'}
        </Button>
      ) : null}
      {mode === 'intro' || mode === 'loading' ? (
        <Button className="ix-skip" onClick={skip}>
          Skip intro ⏭
        </Button>
      ) : null}

      <nav aria-label="Intro chapters" className={`ix-chap${mode === 'intro' ? '' : ' hide'}`}>
        <Button
          size="icon"
          aria-label={ui.playing ? 'Pause' : 'Play'}
          onClick={() => intro.togglePlay()}
          tabIndex={mode === 'intro' ? 0 : -1}
        >
          {ui.playing ? '❚❚' : '▶'}
        </Button>
        <div className="ix-track">
          <div className="rail" />
          <div className="fill" ref={fillRef} />
          {CHAPTERS.map((ch, i) => (
            <button
              key={ch.name}
              type="button"
              ref={(el) => {
                chapRefs.current[i] = el;
              }}
              style={{ left: `${(ch.s / T_HERO) * 100}%` }}
              onClick={() => intro.seekChapter(ch.s)}
              tabIndex={mode === 'intro' ? 0 : -1}
              aria-label={`Chapter: ${ch.name}`}
            >
              <span>{ch.name}</span>
            </button>
          ))}
        </div>
      </nav>

      {explore ? (
        <section className={`ix-explore${hero ? ' hero' : ''}`} aria-label="Explore NISAR in 3D">
          {hero ? (
            <div className="ix-hero">
              <div className="ix-meta">NASA · ISRO · L-band synthetic aperture radar</div>
              <h1 style={{ margin: '10px 0 14px' }}>
                <Lockup size="lg" tone="cream" />
              </h1>
              <p>
                On the night of 17 June 2026, a dam gate failed in northwest Tunisia. NISAR was watching. Follow the
                water.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  className={`ix-start h-auto px-[22px] py-[14px] text-[14px]${ctaPop ? ' pop' : ''}`}
                  onClick={startMission}
                >
                  Start the mission →
                </Button>
                <Button onClick={() => intro.explore()}>Explore the satellite</Button>
                {!ui.autoRot && !intro.reduced ? <Button onClick={() => intro.resumeAuto()}>⟳ Resume spin</Button> : null}
              </div>
            </div>
          ) : (
            <>
              <div className="ix-facts">
                <div className="ix-meta">Explore · drag to orbit</div>
                <h2>NISAR observatory</h2>
                <dl>
                  <dt>Partners</dt>
                  <dd>NASA / JPL + ISRO</dd>
                  <dt>Launch</dt>
                  <dd>30 July 2025 · Sriharikota</dd>
                  <dt>Orbit</dt>
                  <dd>747 km · sun-synchronous</dd>
                  <dt>Repeat</dt>
                  <dd>12 days, global</dd>
                  <dt>Radars</dt>
                  <dd>L-band 24 cm · S-band ~10 cm</dd>
                  <dt>Swath</dt>
                  <dd>242 km</dd>
                </dl>
              </div>
              <Button className="ix-back" onClick={() => intro.backToHero()}>
                ← Back
              </Button>
            </>
          )}
          <div className="ix-hint">
            {ui.autoRot
              ? 'Drag to rotate · scroll to zoom · tap + for details'
              : 'Following you · drag to rotate · scroll to zoom'}
          </div>
          {HOTSPOTS.map((h, i) => (
            <button
              key={h.title}
              type="button"
              className={`ix-hs${ui.hsSel === i ? ' sel' : ''}`}
              aria-label={h.title}
              aria-expanded={ui.hsSel === i}
              ref={(el) => {
                hotRefs.current[i] = el;
              }}
              style={{ display: 'none' }}
              onClick={(e) => {
                e.stopPropagation();
                intro.pauseAuto();
                intro.hsSel = intro.hsSel === i ? -1 : i;
                setUi(snapshot());
              }}
            >
              +
            </button>
          ))}
          {sel ? (
            <div ref={hcardRef} className="ix-hcard" role="dialog" aria-label={sel.title}>
              <h3>{sel.title}</h3>
              <p>{sel.text}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className={`ix-loader${loaderOff ? ' off' : ''}`} role="status" aria-live="polite" aria-hidden={loaderOff}>
        <LogoMark className="ix-lmark text-[#f4f0e6]" animated />
        <div>ACQUIRING SIGNAL</div>
      </div>
    </div>
  );
}
