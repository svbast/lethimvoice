import { bayer, hash } from './engine';

// The mascot player: 11 hand-tuned animation loops. Plain JavaScript on purpose (the
// loops are drawing data more than code); mascot.d.ts gives TypeScript its small surface.
// The stage is 54 × 54 pixels; the mascot is 36 × 41 at (9, 9), feet on row 49.
export class MascotPlayer {
  // el: the 54 × 54 canvas. anim may be changed at any time; the next frame follows it.
  constructor(el, anim) {
    this.el = el;
    this.anim = anim;
    this.t0 = 0; // "splash" runs on this clock (performance.now() ms), shared with its name
  }

  // anim: "random" (every loop in turn), "idle" (stands and blinks), one name, or names joined
  // by commas. Loops play one after another with a short rest between, never the same one twice
  // in a row; a single name rests a little longer. "sleep" dozes off and stays asleep.
  // "splash" is the launch splash (see splash below). A new anim value takes over at once.
  start() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const LEN = { cat: 6.4, asleep: 7, starstruck: 6, angel: 6.4, dance: 4.8, boot: 6,
      lan: 6.4, gpu: 7, read: 7, charts: 6.4, detective: 7, sleep: Infinity };
    let now0 = -1000, key = null, pool = [], playing = 'rest', start = 0, prev = null;
    this.visible = true;
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      const el = this.el;
      if (!el) return;
      if (!el.pxCtx) {
        el.pxCtx = el.getContext('2d');
        el.pxImg = el.pxCtx.createImageData(54, 54);
        if ('IntersectionObserver' in window) {
          this.io = new IntersectionObserver((entries) => { this.visible = entries[0].isIntersecting; });
          this.io.observe(el);
        }
      }
      if (this.visible === false || now - now0 < 40) return;
      now0 = now;
      const t = now / 1000;
      const anim = String(this.anim || 'random');
      if (anim !== key) {
        key = anim;
        pool = anim === 'random' ? Object.keys(LEN).filter((n) => n !== 'sleep') : anim.split(',').map((n) => n.trim()).filter((n) => LEN[n]);
        playing = 'rest';
        start = t - 99;
        prev = null;
      }
      const s = { W: 54, H: 54, buf: el.pxImg.data };
      s.buf.fill(0);
      if (reduce) {
        this.rest(s, 0);
      } else if (anim === 'splash') {
        this.splash(s, (now - this.t0) / 1000, this.windowSpot(el));
      } else {
        if (playing === 'rest' && pool.length && t - start >= (pool.length > 1 ? 1.2 : 2.4)) {
          const next = pool.filter((n) => n !== prev);
          const from = next.length ? next : pool;
          playing = from[Math.floor(Math.random() * from.length)];
          start = t;
        } else if (playing !== 'rest' && t - start >= LEN[playing]) {
          prev = playing;
          playing = 'rest';
          start = t;
        }
        if (playing === 'rest') this.rest(s, (t - start) % 4);
        else this.loops()[playing].call(this, s, t - start);
      }
      el.pxCtx.putImageData(el.pxImg, 0, 0);
      if (reduce) cancelAnimationFrame(this.raf);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    if (this.io) this.io.disconnect();
  }

  // The resting pose between animations: standing still, one blink.
  rest(s, t) {
    this.shadow(s, 27, 26, 0.35);
    this.blit(s, this.frame(this.blink(t, 0.6, 'open'), 0, 0));
  }

  // The app's launch splash. He and the name are one picture: a single sweep, left to right
  // across the window, draws him in (0-1.1 s), he boots at 2.5x speed, and at OUT the same
  // sweep takes him out. src/components/NameReveal.tsx keeps the same timeline.
  splash(s, t, spot) {
    const OUT = 2.1;
    if (t >= OUT + 1.2) return;
    this.boot(s, t < 1.1 ? 0 : Math.min((t - 1.1) * 2.5, 4.99));
    if (t < 1.2) this.sweep(s, t, false, spot);
    else if (t >= OUT) this.sweep(s, t - OUT, true, spot);
  }
  // Pixels land (out: go out) left to right across the window with some scatter, each one with
  // a white spark. The timing is NameReveal's, so his pixels and the letters share one sweep.
  sweep(s, q, out, spot) {
    const b = s.buf, cell = spot.cell;
    for (let y = 0; y < 54; y++) for (let x = 0; x < 54; x++) {
      const k = (y * 54 + x) * 4;
      if (!b[k + 3]) continue;
      const on = 1.1 * (0.92 * Math.min(1, (spot.x + (x + 0.5) * cell) / spot.w) + 0.08 * hash(x, y, 3));
      if (out ? q >= on + 0.06 : q < on) { b[k + 3] = 0; continue; }
      if (q >= on && q < on + 0.06) { b[k] = this.C.white[0]; b[k + 1] = this.C.white[1]; b[k + 2] = this.C.white[2]; }
    }
  }
  // Where the canvas sits in the window (the outermost .app around it), in window px.
  windowSpot(el) {
    let root = el;
    for (let n = el; n; n = n.parentElement) if (n.classList && n.classList.contains('app')) root = n;
    const r = root.getBoundingClientRect(), c = el.getBoundingClientRect();
    const w = root.offsetWidth || r.width || 960, k = r.width / w || 1;
    return { x: (c.left - r.left) / k, w, cell: el.clientWidth / 54 };
  }

  // Dozes off like Asleep, then keeps snoozing: the Z's repeat every 0.7 s, so 2.1 s loops cleanly.
  sleep(s, t) {
    this.asleep(s, t < 3.6 ? t : 3.6 + ((t - 3.6) % 2.1));
  }

  // Every loop by the name anim uses.
  loops() {
    return { cat: this.cat, asleep: this.asleep, starstruck: this.starstruck, angel: this.angel,
      dance: this.dance, boot: this.boot, lan: this.lan, gpu: this.gpu, read: this.read,
      charts: this.charts, detective: this.detective, sleep: this.sleep };
  }

  /* Every loop starts and ends in the same resting pose, so it can repeat or hand over to another.
     Stage: 54 × 54 pixels (4 px each at 216 px). Mascot: 36 × 41 at (9, 9), feet on row 49. */

  /* ── 1 · Cat ── */
  // The cat slips out from behind him, stops, leaps across in front of him to the other side,
  // looks at him, then runs back behind him. Its art faces left; flip turns it to face right.
  cat(s, t) {
    const p = t % 6.4;
    let cx = null, cy = 40, rows = this.ART.catWalkB, flip = true, catA = 1, behind = false, onGround = true;
    const walk = (hz) => (Math.floor(p * hz) % 2 ? this.ART.catWalkA : this.ART.catWalkB);
    const tail = Math.floor(p * 2.5) % 2 ? this.ART.catStand : this.ART.catWalkB;
    if (p >= 0.3 && p < 1.4) {
      const q = (p - 0.3) / 1.1;
      cx = Math.round(20 + 18 * this.ease(q)); rows = walk(6); behind = true; catA = Math.min(1, q * 5);
    } else if (p >= 1.4 && p < 1.8) cx = 38;
    else if (p >= 1.8 && p < 2.7) { cx = 38; rows = tail; flip = false; }
    else if (p >= 2.7 && p < 3.3) {
      const q = (p - 2.7) / 0.6;
      cx = Math.round(38 - 38 * q); cy = 40 - Math.round(13 * Math.sin(q * Math.PI)); rows = this.ART.catLeap; flip = false; onGround = false;
    } else if (p >= 3.3 && p < 3.8) { cx = 0; flip = false; }
    else if (p >= 3.8 && p < 4.2) { cx = 0; rows = tail; }
    else if (p >= 4.2 && p < 5) {
      const q = (p - 4.2) / 0.8;
      cx = Math.round(22 * this.ease(q)); rows = walk(9); behind = true; catA = Math.min(1, (1 - q) * 3);
    }
    // heart eyes the whole time the cat is around
    const love = p >= 0.45 && p < 4.9;
    const eyes = love ? 'none' : (p >= 0.35 && p < 0.45) || (p >= 4.9 && p < 5) ? 'half' : this.blink(p, 5.8, 'open');
    const f = this.frame(eyes, 0, 0);
    this.shadow(s, 27, 26, 0.35);
    if (cx !== null) {
      const sx = (onGround ? cx : Math.round(38 - 38 * ((p - 2.7) / 0.6))) + 8;
      for (let x = -5; x <= 5; x++) this.put(s, sx + x, 50, this.C.dark, catA * (onGround ? 0.3 : 0.15) * (1 - (x * x) / 30));
    }
    const drawCat = () => this.art(s, cx, cy, rows, this.CAT, catA, flip);
    if (cx !== null && behind) drawCat();
    this.blit(s, f);
    if (love) {
      const big = Math.sin(p * Math.PI * 3.2) > 0;
      const look = Math.max(-1, Math.min(1, Math.round((cx + 8 - 27) / 10)));
      for (const ex of [25, 36]) {
        if (big) this.stamp(s, ex - 2 + look, 20, ['.#.#.', '#####', '.###.', '..#..'], this.C.heart, 1);
        else this.stamp(s, ex - 1 + look, 21, ['#.#', '###', '.#.'], this.C.heart, 1);
      }
      const fade = Math.min(1, (4.9 - p) / 0.4);
      for (let k = 0; k < 3; k++) {
        if (p - 0.6 < k * 0.4) continue;
        const q = ((p - 0.6) / 1.2 + k / 3) % 1;
        this.stamp(s, 20 + k * 6, Math.round(8 - q * 9), ['#.#', '###', '.#.'], this.C.heart, 0.9 * (1 - q) * fade);
      }
    }
    if (cx !== null && !behind) drawCat();
    if (p >= 3.3 && p < 3.6) {
      const q = (p - 3.3) / 0.3;
      for (const d of [-1, 1]) this.put(s, 8 + d * Math.round(3 + q * 5), 49, this.C.text, 0.6 * (1 - q));
    }
  }

  /* ── 2 · Asleep ── */
  asleep(s, t) {
    const p = t % 7;
    let eyes = this.blink(p, 6.6, 'open'), nod = 0, dim = 0, hop = 0;
    if (p >= 1 && p < 1.35) eyes = 'half';
    else if (p >= 1.35 && p < 1.6) eyes = 'shut';
    else if (p >= 1.6 && p < 1.85) eyes = 'half';
    else if (p >= 1.85 && p < 5.8) {
      eyes = 'shut';
      dim = p >= 2.1 ? 1 : 0;
      nod = Math.sin(((p - 1.85) / 1.6) * Math.PI * 2) > 0.2 ? 1 : 0;
    } else if (p >= 5.8 && p < 6) { eyes = 'open'; hop = -1; }
    const f = this.frame(eyes, 0, 0);
    this.dim(f, dim);
    this.shadow(s, 27, 26, 0.35);
    this.part(s, f, 0, 35, 35, 40, 0, hop);
    this.part(s, f, 0, 35, 0, 34, 0, nod + hop);
    if (p >= 2.2 && p < 5.8) {
      const Z = [['####', '..#.', '.#..', '####'], ['#####', '...#.', '..#..', '.#...', '#####']];
      for (let k = 0; k < 3; k++) {
        const q = ((p - 2.2) / 2.1 + k / 3) % 1;
        if (p - 2.2 < k * 0.7) continue;
        const a = Math.min(1, q * 5) * (1 - q);
        this.stamp(s, Math.round(32 + q * 14), Math.round(7 - q * 10), Z[q < 0.45 ? 0 : 1], this.C.text, a);
      }
    }
  }

  /* ── 3 · Starstruck ── */
  starstruck(s, t) {
    const p = t % 6;
    const anime = p >= 0.8 && p < 5;
    const eyes = anime ? 'none' : (p >= 0.65 && p < 0.8) || (p >= 5 && p < 5.15) ? 'half' : this.blink(p, 5.6, 'open');
    const f = this.frame(eyes, 0, 0);
    const show = p >= 0.8 && p < 5.2 ? Math.min(1, (p - 0.8) / 0.6, (5.2 - p) / 0.6) : 0;
    const stars = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + (p / 3) * Math.PI * 2;
      stars.push([Math.round(27 + 23 * Math.cos(a)), Math.round(30 + 6 * Math.sin(a)), Math.sin(a) >= 0, k]);
    }
    const star = (x, y, k, a, front) => {
      const tw = (Math.floor(p * 5) + k) % 5 === 0;
      if (front && !tw) this.stamp(s, x - 2, y - 2, ['..#..', '.###.', '#####', '.###.', '.#.#.'], k % 2 ? this.C.white : this.C.star, a);
      else this.stamp(s, x - 1, y - 1, ['.#.', '###', '.#.'], k % 2 ? this.C.white : this.C.star, a);
    };
    if (show) for (const [x, y, front, k] of stars) if (!front) star(x, y, k, show * 0.5, false);
    this.shadow(s, 27, 26, 0.35);
    this.blit(s, f);
    if (anime) {
      const tw = Math.floor(p * 3) % 2;
      for (const ex of [23, 34]) {
        this.art(s, ex, 19, ['.KKK.', tw ? 'KWKKK' : 'KWWKK', tw ? 'KKKKK' : 'KWKKK', 'KKKWK', 'KBBBK', 'KbbbK', '.KKK.'], this.EYE, 1);
      }
      this.stamp(s, 20, 27, ['##'], this.C.heart, 0.55);
      this.stamp(s, 40, 27, ['##'], this.C.heart, 0.55);
    }
    if (show) for (const [x, y, front, k] of stars) if (front) star(x, y, k, show, true);
  }

  /* ── 4 · Angel ── */
  angel(s, t) {
    const p = t % 6.4;
    let wing = 0, dy = 0;
    if (p >= 0.6 && p < 1.2) wing = this.ease((p - 0.6) / 0.6);
    else if (p >= 1.2 && p < 4.8) wing = 1;
    else if (p >= 4.8 && p < 5.4) wing = 1 - this.ease((p - 4.8) / 0.6);
    if (p >= 1.2 && p < 1.8) dy = -Math.round(3 * this.ease((p - 1.2) / 0.6));
    else if (p >= 1.8 && p < 4.2) dy = -3 - (Math.sin(((p - 1.8) / 1.2) * Math.PI * 2) > 0.5 ? 1 : 0);
    else if (p >= 4.2 && p < 4.8) dy = -3 + Math.round(3 * this.ease((p - 4.2) / 0.6));
    const starEyes = p >= 1.3 && p < 4.7;
    const eyes = starEyes ? 'none' : (p >= 1.2 && p < 1.3) || (p >= 4.7 && p < 4.8) ? 'half' : this.blink(p, 5.9, 'open');
    const f = this.frame(eyes, 0, 0);
    this.shadow(s, 27, 26 + dy * 3, 0.35);
    if (wing > 0) {
      const flap = p >= 1.8 && p < 4.2 && Math.floor(p * 4) % 2 ? this.ART.wingDown : this.ART.wingUp;
      const cols = Math.round(wing * 14);
      this.art(s, 40, 12 + dy, flap, this.WING, 1, false, cols);
      this.art(s, 0, 12 + dy, flap, this.WING, 1, true, cols);
    }
    this.blit(s, f, { dy });
    if (starEyes) {
      const rows = ['..#..', '.###.', '#####', '.###.', '.#.#.'];
      for (const ex of [23, 34]) {
        for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) this.stamp(s, ex + ox, 20 + dy + oy, rows, this.P[5], 1);
        this.stamp(s, ex, 20 + dy, rows, this.C.star, 1);
      }
    }
    if (wing > 0) {
      const y = 9 + dy - 5 - Math.round((1 - wing) * 3);
      this.stamp(s, 21, y, ['..#########..', '##.........##', '..#########..'], this.C.star, Math.min(1, wing * 1.3));
    }
    if (p >= 1.8 && p < 4.2) {
      for (let k = 0; k < 4; k++) {
        const q = ((p - 1.8) / 1.1 + k / 4) % 1;
        this.put(s, k % 2 ? 50 - k : 3 + k, Math.round(26 + dy + q * 20), this.C.white, 0.75 * (1 - q));
      }
    }
  }

  /* ── 5 · Dance ── */
  dance(s, t) {
    const k = Math.floor((t % 2.4) / 0.3);
    const dx = [0, 1, 1, 0, 0, -1, -1, 0][k];
    const f = this.frame('happy', 0, 0);
    this.shadow(s, 27 + dx, 26, 0.35);
    this.part(s, f, 8, 15, 35, 40, dx, k % 4 === 1 ? -2 : 0);
    this.part(s, f, 20, 27, 35, 40, dx, k % 4 === 3 ? -2 : 0);
    this.part(s, f, 0, 35, 0, 34, dx, k % 2 ? -1 : 0);
    const note = ['..##', '..#.', '..#.', '###.', '##..'];
    this.stamp(s, 3, 1 + (k % 2), note, this.C.blue, 0.85);
    this.stamp(s, 47, 2 + ((k + 1) % 2), note, this.C.white, 0.7);
  }

  /* ── 6 · Boot: types its start-up text, switches the screen off, wakes; at the end it powers down again ── */
  boot(s, t) {
    const p = t % 6;
    const screenOn = p < 2.9 || p >= 5.9;
    let dim = 0, eyes = this.blink(p, 4.3, 'open');
    if (screenOn) { dim = 2; eyes = 'none'; }
    else if (p < 3.05) { dim = 1; eyes = 'half'; }
    else if (p < 3.15) eyes = 'half';
    else if (p >= 5 && p < 5.15) eyes = 'half';
    else if (p >= 5.15 && p < 5.4) { eyes = 'shut'; dim = 1; }
    else if (p >= 5.4) { eyes = 'none'; dim = 2; }
    const f = this.frame(eyes, 0, 0);
    this.dim(f, dim);
    if (p >= 3.2 && p < 4) this.glint(f, (p - 3.2) * 80 - 4, 1.4, 1);
    this.shadow(s, 27, 26, 0.35);
    this.blit(s, f);
    const cx = 27, cy = 26;
    if (p >= 5.6 && p < 5.9) {
      const w = Math.max(1, Math.round(24 * this.ease((p - 5.6) / 0.3)));
      for (let x = 0; x < w; x++) this.put(s, cx - Math.floor(w / 2) + x, cy, this.C.white, 0.9);
      return;
    }
    if (!screenOn) return;
    const box = this.screen(s);
    if (p >= 5.9) return;
    if (p < 2.5) {
      const lines = ['LETHIM', 'VOICE', 'MIC OK', 'NET OK', 'READY'];
      let left = Math.max(0, Math.floor((p - 0.3) * 14));
      const shown = [];
      for (const line of lines) {
        if (left <= 0) break;
        shown.push(line.slice(0, left));
        left -= line.length + 1;
      }
      const from = Math.max(0, shown.length - 3);
      shown.slice(from).forEach((str, n) => {
        this.text(s, box.x, box.y + 1 + n * 6, str, from + n === 4 ? this.C.white : this.C.blue, 0.85);
      });
      if (Math.floor(p * 4) % 2 && shown.length) {
        const lastN = shown.length - 1 - from;
        this.stamp(s, box.x + Math.min(23, shown[shown.length - 1].length * 4), box.y + 1 + lastN * 6, ['#', '#', '#', '#', '#'], this.C.blue, 0.7);
      }
    } else if (p < 2.6) {
      for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) this.put(s, box.x + x, box.y + y, this.C.white, 0.7);
    } else {
      const w = Math.max(1, Math.round(24 * (1 - this.ease((p - 2.6) / 0.3))));
      for (let x = 0; x < w; x++) this.put(s, cx - Math.floor(w / 2) + x, cy, this.C.white, 0.9);
    }
  }

  /* ── 7 · LAN: a network plug slides into his left side, his eyes turn into speedometers and the needles hit max ── */
  lan(s, t) {
    const p = t % 6.4;
    let px = null, port = 0, gauge = 0, ang = Math.PI, jolt = 0;
    if (p >= 0.4 && p < 0.6) port = (p - 0.4) / 0.2;
    else if (p >= 0.6 && p < 5.4) port = 1;
    else if (p >= 5.4 && p < 5.6) port = 1 - (p - 5.4) / 0.2;
    if (p >= 0.5 && p < 1.15) px = Math.round(-10 + 13 * this.ease((p - 0.5) / 0.65));
    else if (p >= 1.15 && p < 4.8) px = 3 + (p < 1.25 ? 1 : 0);
    else if (p >= 4.8 && p < 5.4) px = Math.round(3 - 13 * this.ease((p - 4.8) / 0.6));
    if (p >= 1.15 && p < 1.25) jolt = 1;
    if (p >= 1.5 && p < 1.7) gauge = (p - 1.5) / 0.2;
    else if (p >= 1.7 && p < 4.3) gauge = 1;
    else if (p >= 4.3 && p < 4.5) gauge = 1 - (p - 4.3) / 0.2;
    if (p >= 1.8 && p < 2.6) { const q = (p - 1.8) / 0.8; ang = Math.PI * (1 - q * q); }
    else if (p >= 2.6 && p < 3.9) ang = 0.14 + (Math.floor(p * 14) % 2 ? 0.12 : 0);
    else if (p >= 3.9 && p < 4.3) ang = Math.PI * this.ease((p - 3.9) / 0.4);
    const eyes = gauge > 0 ? 'none' : (p >= 1.4 && p < 1.5) || (p >= 4.5 && p < 4.6) ? 'half' : this.blink(p, 6, 'open');
    const f = this.frame(eyes, 0, 0);
    this.shadow(s, 27 + jolt, 26, 0.35);
    this.blit(s, f, { dx: jolt });
    if (port > 0) this.stamp(s, 9 + jolt, 30, ['##', '##', '##', '##'], this.C.scan, port);
    if (px !== null) {
      const cab = this.mix(this.C.blue, this.P[1], 0.5);
      this.art(s, px, 29, ['.KKKKKK.', 'KBBwwwwK', 'KBBwwwyK', 'KBBwwwyK', 'KBBwwwwK', '.KKKKKK.'],
        { K: this.P[5], B: cab, w: [196, 204, 212], y: this.C.star }, 1);
    }
    if (p >= 1.15 && p < 1.4) {
      const q = (p - 1.15) / 0.25;
      for (const [dx, dy] of [[1, -1], [1, 1], [2, 0]]) this.put(s, 11 + Math.round(dx * (2 + q * 3)), 31 + Math.round(dy * (2 + q * 3)), this.C.white, 1 - q);
    }
    if (gauge > 0) for (const cx of [24, 37]) this.gauge(s, cx, 24, ang, gauge, p >= 2.6 && p < 3.9 && Math.floor(p * 7) % 2);
  }
  // A speedometer as an eye: dark dial, blue arc with a red end, white needle; ang π = min, 0 = max.
  gauge(s, cx, cy, ang, a, flash) {
    for (let dy = -5; dy <= 1; dy++) for (let dx = -5; dx <= 5; dx++) {
      const d = Math.hypot(dx, dy), th = Math.atan2(-dy, dx);
      let c = null;
      if (dy === 1) c = this.P[5];
      else if (d <= 3.6) c = this.C.screen;
      else if (d <= 4.6) c = th < 0.75 ? (flash ? this.C.white : this.C.heart) : this.C.blue;
      else if (d <= 5.4) c = this.P[5];
      if (c) this.put(s, cx + dx, cy + dy, c, a);
    }
    for (let r = 1; r <= 3; r++) this.put(s, cx + Math.round(r * Math.cos(ang)), cy - Math.round(r * Math.sin(ang)), this.C.white, a);
    this.put(s, cx, cy, this.C.star, a);
  }

  /* ── 8 · GPU: a hatch on his belly opens on a graphics card; its fan spins up, so do his eyes, arrows rise ── */
  gpu(s, t) {
    const p = t % 7;
    let open = 0, seam = 0, fan = 0;
    if (p >= 0.5 && p < 0.7) seam = (p - 0.5) / 0.2;
    else if (p >= 0.7 && p < 5.9) seam = 1;
    else if (p >= 5.9 && p < 6.1) seam = 1 - (p - 5.9) / 0.2;
    if (p >= 0.7 && p < 1.2) open = this.ease((p - 0.7) / 0.5);
    else if (p >= 1.2 && p < 5.4) open = 1;
    else if (p >= 5.4 && p < 5.9) open = 1 - this.ease((p - 5.4) / 0.5);
    if (p >= 1.5 && p < 1.7) fan = (p - 1.5) / 0.2;
    else if (p >= 1.7 && p < 5.2) fan = 1;
    else if (p >= 5.2 && p < 5.4) fan = 1 - (p - 5.2) / 0.2;
    // fan speed in turns a second, and how far it has turned so far
    const W = 5;
    let w = 0, turn = 0;
    if (p >= 1.6 && p < 3) { const u = (p - 1.6) / 1.4; w = W * u * u; turn = (W * 1.4 * u * u * u) / 3; }
    else if (p >= 3 && p < 4.4) { w = W; turn = (W * 1.4) / 3 + W * (p - 3); }
    else if (p >= 4.4 && p < 5.2) { const v = (p - 4.4) / 0.8; w = W * (1 - v) * (1 - v); turn = (W * 1.4) / 3 + W * 1.4 + (W * 0.8 * (1 - Math.pow(1 - v, 3))) / 3; }
    else if (p >= 5.2) turn = (W * 1.4) / 3 + W * 1.4 + (W * 0.8) / 3;
    const blur = Math.max(0, Math.min(1, (w - 1.5) / 1.5));
    const eyes = fan > 0 ? 'none' : (p >= 1.4 && p < 1.5) || (p >= 5.4 && p < 5.5) ? 'half' : this.blink(p, 6.5, 'open');
    const f = this.frame(eyes, 0, 0);
    this.shadow(s, 27, 26, 0.35);
    this.blit(s, f);
    const X0 = 15, Y0 = 27, CW = 24, CH = 13;
    if (seam > 0) {
      for (let x = -1; x <= CW; x++) { this.put(s, X0 + x, Y0 - 1, this.P[5], seam * 0.8); this.put(s, X0 + x, Y0 + CH, this.P[5], seam * 0.8); }
      for (let y = 0; y < CH; y++) { this.put(s, X0 - 1, Y0 + y, this.P[5], seam * 0.8); this.put(s, X0 + CW, Y0 + y, this.P[5], seam * 0.8); }
      if (open === 0) for (let y = 0; y < CH; y++) this.put(s, X0 + CW / 2, Y0 + y, this.P[5], seam * 0.6);
    }
    if (open > 0) {
      const half = (open * CW) / 2, mid = X0 + CW / 2;
      const inside = (x) => Math.abs(x + 0.5 - mid) < half;
      const led = w > 0.3 ? [this.C.blue, this.C.heart, this.C.star][Math.floor(p * 3) % 3] : this.P[1];
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
        const gx = X0 + x;
        if (!inside(gx)) continue;
        let c = [22, 24, 28];
        if (y >= 1 && y <= 10 && x >= 1 && x <= 22) c = y === 1 ? this.P[1] : [50, 54, 60];
        if (y === 11 && x >= 5 && x <= 18) c = x % 2 ? this.C.straw : this.C.strawDark;
        if (y >= 3 && y <= 9 && x >= 13 && x <= 21) c = y === 3 ? this.mix(this.P[1], led, w > 0.3 ? 0.8 : 0) : x % 2 ? this.P[2] : [36, 39, 44];
        this.put(s, gx, Y0 + y, c, 1);
      }
      this.fan(s, X0 + 7, Y0 + 6, 4.3, turn, blur, inside);
      for (const e of [-1, 1]) this.put(s, Math.round(mid + e * half), Y0 + 6, this.P[5], 1);
    }
    if (fan > 0) for (const ex of [25, 36]) this.fan(s, ex, 22, 3.5, turn * 1.3, blur, null, fan, true);
    if (p >= 2.4 && p < 4.8) {
      // more power: arrows rise on both sides of him and fade
      const end = Math.min(1, (4.8 - p) / 0.3);
      const up = ['..#..', '.###.', '##.##', '#...#'];
      for (const [x, ph, big] of [[2, 0, 1], [47, 0.45, 1], [3, 0.7, 0], [46, 0.2, 0]]) {
        if (p - 2.4 < ph) continue;
        const q = ((p - 2.4 - ph) / 1) % 1;
        this.stamp(s, x, Math.round(42 - q * 30), big ? up.concat(up) : up, big ? this.C.blue : this.C.white, 0.9 * Math.min(1, q * 6) * (1 - q) * end);
      }
    }
  }
  // A round fan centred on pixel (cx, cy): a ring, blades turned by `turn`, smeared into a disc by `blur`.
  fan(s, cx, cy, r, turn, blur, clip, a, rim) {
    const n = Math.ceil(r);
    for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > r || (clip && !clip(cx + dx))) continue;
      let c;
      if (d > r - 0.9) c = rim ? this.P[5] : this.P[2];
      else if (d < 1) c = rim ? this.P[2] : this.P[5];
      else {
        const th = Math.atan2(dy, dx) / (Math.PI * 2);
        const k = ((th * (rim ? 3 : 5) + turn + d * 0.08) % 1 + 1) % 1;
        const blade = k < 0.45 ? this.P[4] : rim ? this.C.screen : [30, 32, 36];
        c = this.mix(blade, this.mix(this.P[3], this.P[1], d / r), blur);
      }
      this.put(s, cx + dx, cy + dy, c, a == null ? 1 : a);
    }
  }

  /* ── 9 · Reading: a book pops up in front of him, glasses drop on, his eyes run along the lines ── */
  read(s, t) {
    const p = t % 7;
    let book = null, bookA = 1, glass = null, glassA = 1, gx = 0, gy = 0, eyes = this.blink(p, 6.3, 'open');
    if (p >= 0.5 && p < 0.9) { const q = this.ease((p - 0.5) / 0.4); book = Math.round(10 * (1 - q)); bookA = q; }
    else if (p >= 0.9 && p < 5.5) book = 0;
    else if (p >= 5.5 && p < 5.9) { const q = this.ease((p - 5.5) / 0.4); book = Math.round(10 * q); bookA = 1 - q; }
    if (p >= 0.9 && p < 1.3) { const q = (p - 0.9) / 0.4; glass = -Math.round(8 * (1 - q) * (1 - q)); glassA = Math.min(1, q * 2); }
    else if (p >= 1.3 && p < 5.1) glass = 0;
    else if (p >= 5.1 && p < 5.45) { const q = (p - 5.1) / 0.35; glass = -Math.round(8 * q * q); glassA = 1 - q; }
    if (p >= 1.35 && p < 5.05) {
      // four lines: the gaze steps right to left (his left to right), then jumps back to the start
      const u = (p - 1.35) % 0.925;
      gy = 1;
      gx = u < 0.8 ? 2 - Math.floor(u / 0.16) : 2;
      if (p >= 3.2 && p < 3.3) eyes = 'half';
    }
    const f = this.frame(eyes, gx, gy);
    this.shadow(s, 27, 26, 0.35);
    this.blit(s, f);
    if (glass !== null) {
      const y = 19 + glass, rim = this.P[5];
      for (const x0 of [21, 32]) {
        for (let j = 0; j < 8; j++) for (let i = 0; i < 9; i++) {
          if ((i === 0 || i === 8) && (j === 0 || j === 7)) continue;
          const edge = i === 0 || i === 8 || j === 0 || j === 7;
          if (edge) this.put(s, x0 + i, y + j, rim, glassA);
          else if (glass === 0 && ((i === 1 && j === 1) || (i === 2 && j === 1) || (i === 1 && j === 2))) this.put(s, x0 + i, y + j, this.C.white, 0.6 * glassA);
        }
      }
      this.stamp(s, 30, y + 2, ['##'], rim, glassA);
      this.stamp(s, 15, y + 2, ['######'], rim, glassA);
      this.stamp(s, 41, y + 2, ['###'], rim, glassA);
    }
    if (book !== null) this.book(s, 14, 33 + book, bookA);
  }
  // An open book facing out: curved white pages with lines of text inside a red cover.
  book(s, x0, y0, a) {
    const W = 27, mid = 13;
    for (let x = 0; x < W; x++) {
      const e = Math.abs(x - mid) / mid;
      const top = Math.round(2 * (1 - e * e)), bot = 10 + (x === mid ? 1 : 0);
      for (let y = top; y <= bot + 1; y++) {
        let c;
        if (x === 0 || x === W - 1 || y === top || y === bot + 1) c = this.P[5];
        else if (y === bot || x === 1 || x === W - 2) c = [150, 84, 92];
        else if (x === mid) c = this.P[2];
        else {
          c = this.C.white;
          const line = y - top - 1;
          if (line >= 1 && line % 2 === 1 && x > 2 && x < W - 3 && Math.abs(x - mid) > 1 && hash(x >> 1, line, 7) > 0.22) c = this.P[3];
        }
        this.put(s, x0 + x, y0 + y, c, a);
      }
    }
  }

  /* ── 10 · Charts: charts and formulas circle around him, his eyes follow them, ? and ! pop up as he thinks ── */
  charts(s, t) {
    const p = t % 6.4;
    const items = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + (p / 3.4) * Math.PI * 2;
      const show = Math.max(0, Math.min(1, (p - 0.7 - k * 0.1) / 0.25, (5.2 - k * 0.08 - p) / 0.25));
      items.push({ k, x: Math.round(27 + 21 * Math.cos(a)), y: Math.round(31 + 8 * Math.sin(a)), front: Math.sin(a) >= 0, show });
    }
    const front = items.filter((it) => it.front && it.show > 0).sort((m, n) => n.y - m.y)[0];
    const look = front && p > 1 && p < 5.2 ? Math.max(-1, Math.min(1, Math.round((front.x - 27) / 9))) : 0;
    const f = this.frame(this.blink(p, 5.9, 'open'), look, 0);
    const map = { b: this.C.blue, y: this.C.star, r: this.C.heart, w: this.C.white };
    const draw = (it) => {
      const g = this.ease(it.show);
      let rows;
      if (it.k === 0) {
        // bars grow as it appears
        const h = [3, 5, 4].map((v) => Math.max(1, Math.round(v * g)));
        rows = [];
        for (let y = 0; y < 5; y++) rows.push([0, 1, 2].map((n) => (5 - y <= h[n] ? 'bb' : '..')).join('.'));
      } else if (it.k === 1) {
        // the red slice turns slowly
        rows = [];
        for (let y = 0; y < 7; y++) {
          let row = '';
          for (let x = 0; x < 7; x++) {
            const dx = x - 3, dy = y - 3;
            const th = ((Math.atan2(dy, dx) / (Math.PI * 2) + p * 0.6) % 1 + 1) % 1;
            row += dx * dx + dy * dy > 11 ? '.' : th < 0.28 ? 'r' : 'y';
          }
          rows.push(row);
        }
      } else if (it.k === 2) {
        // the line draws itself as it appears
        const n = Math.round(8 * g);
        rows = ['.......w', '......w.', '..w..w..', '.w.ww...', 'w.......'].map((r) => r.slice(0, n) + '.'.repeat(8 - n));
      } else if (it.k === 3) rows = ['yyyy', '.y..', '..y.', '.y..', 'yyyy'];
      else if (it.k === 4) rows = ['wwwww', '.w.w.', '.w.w.', '.w..w'];
      else rows = ['rr..r', 'rr.r.', '..r..', '.r.rr', 'r..rr'];
      const w = rows[0].length, h = rows.length;
      this.sticker(s, it.x - (w >> 1), it.y - (h >> 1), rows, map, it.front ? it.show : it.show * 0.7, this.P[5]);
    };
    for (const it of items) if (!it.front && it.show > 0) draw(it);
    this.shadow(s, 27, 26, 0.35);
    this.blit(s, f);
    for (const it of items) if (it.front && it.show > 0) draw(it);
    // one mark every 0.35 s, each in a different spot from the one before
    const SPOTS = [[3, 10], [8, 3], [17, 2], [26, 1], [35, 2], [43, 3], [48, 10]];
    const spot = (m) => {
      const i = Math.floor(hash(m, 3, 11) * SPOTS.length);
      return m > 0 && i === Math.floor(hash(m - 1, 3, 11) * SPOTS.length) ? (i + 1) % SPOTS.length : i;
    };
    const now = Math.floor((p - 1.2) / 0.35);
    for (let m = now - 2; m <= now; m++) {
      const t0 = 1.2 + m * 0.35;
      if (m < 0 || t0 > 4.6 || p - t0 >= 0.9) continue;
      const [x, y] = SPOTS[spot(m)], bang = hash(m, 5, 13) < 0.4;
      this.mark(s, x, y, bang ? '!' : '?', (p - t0) / 0.9, bang ? this.C.star : this.C.white);
    }
  }
  // A ? or ! that pops up at (x, y), drifts up a little and fades; q runs 0..1 over its life.
  mark(s, x, y, glyph, q, c) {
    const G = { '?': ['.##.', '#..#', '...#', '..#.', '....', '..#.'], '!': ['#', '#', '#', '#', '.', '#'],
      Q: ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'] };
    const a = Math.min(1, q / 0.12, (1 - q) / 0.3);
    this.sticker(s, x, y - Math.round(q * 2) + (q < 0.08 ? 1 : 0), G[glyph], { '#': c }, a, this.P[5]);
  }
  // A coloured bitmap with a 1-px dark outline, so it reads both over the body and over the background.
  sticker(s, x, y, rows, map, a, edge) {
    const on = (i, j) => j >= 0 && j < rows.length && i >= 0 && i < rows[j].length && map[rows[j][i]];
    for (let j = -1; j <= rows.length; j++) for (let i = -1; i <= rows[0].length; i++) {
      if (on(i, j)) continue;
      if (on(i - 1, j) || on(i + 1, j) || on(i, j - 1) || on(i, j + 1)) this.put(s, x + i, y + j, edge, a);
    }
    this.art(s, x, y, rows, map, a);
  }

  /* ── 11 · Detective: a monocle on one eye, he looks left and right, a few question marks pop up and fade ── */
  detective(s, t) {
    const p = t % 7;
    let mono = null, monoA = 1, look = 0, eyes = this.blink(p, 6.2, 'open');
    if (p >= 0.6 && p < 0.9) { const q = (p - 0.6) / 0.3; mono = -Math.round(6 * (1 - q) * (1 - q)); monoA = q; }
    else if (p >= 0.9 && p < 4.7) mono = 0;
    else if (p >= 4.7 && p < 5.1) { const q = (p - 4.7) / 0.4; mono = Math.round(12 * q * q); monoA = 1 - q; }
    if ((p >= 1.2 && p < 1.7) || (p >= 3 && p < 3.5)) look = -1;
    else if (p >= 1.9 && p < 2.4) look = 1;
    const lens = mono === 0;
    if (lens) eyes = ['half', 'none'];
    const f = this.frame(eyes, look, 0);
    this.shadow(s, 27, 26, 0.35);
    this.blit(s, f);
    if (mono !== null) {
      const cx = 36, cy = 22 + mono;
      if (lens) {
        // the eye behind the monocle looks huge
        this.stamp(s, cx - 2 + look, cy - 3, ['.###.', '#####', '#####', '#####', '#####', '#####', '.###.'], this.P[5], 1);
        this.put(s, cx - 1 + look, cy - 2, this.C.white, 0.9);
      }
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > 3.5 && d <= 4.5) this.put(s, cx + dx, cy + dy, dx + dy < -1 ? this.C.star : [190, 160, 96], monoA);
        else if (d > 4.5 && d <= 5.4) this.put(s, cx + dx, cy + dy, this.P[5], monoA);
        else if (d <= 3.5 && dx + dy <= -4 && dx + dy >= -5) this.put(s, cx + dx, cy + dy, this.C.white, 0.5 * monoA);
      }
      for (const [x, y] of [[39, 27], [40, 29], [41, 31], [41, 33], [42, 35]]) this.put(s, x, y + mono, this.C.star, monoA);
    }
    for (const [x, y, g, t0] of [[46, 2, 'Q', 1.5], [4, 5, '?', 2], [18, 3, '?', 2.6], [31, 2, '?', 3.1]]) {
      if (p >= t0 && p < t0 + 1.5) this.mark(s, x, y, g, (p - t0) / 1.5, g === 'Q' ? this.C.star : this.C.white);
    }
  }

  /* ── sprite: 36 × 41, five muted tones dithered together; eyes are drawn on top so they can change ── */

  get P() {
    // five steel tones, then the outline and eyes
    return this.pCache || (this.pCache = [[60, 63, 69], [86, 90, 97], [115, 119, 125], [144, 150, 156], [178, 186, 194],
      [30, 31, 34]]);
  }
  get C() {
    return this.cCache || (this.cCache = { blue: [184, 230, 254], heart: [232, 130, 150], star: [232, 206, 140], white: [226, 230, 234],
      text: [200, 210, 222], dark: [0, 0, 0], straw: [214, 184, 110], strawDark: [160, 130, 70], screen: [26, 30, 36], scan: [20, 23, 28] });
  }
  get CAT() { return { K: [52, 40, 32], o: [214, 150, 100], d: [178, 114, 70], E: [34, 30, 28], P: [214, 120, 130], w: [236, 226, 212], i: [226, 150, 160] }; }
  get WING() { return { K: [30, 31, 34], w: [200, 204, 208], g: [160, 165, 172] }; }
  get EYE() { return { K: [30, 31, 34], W: [236, 238, 240], B: [96, 126, 186], b: [140, 176, 226] }; }
  // 3 × 5 pixel letters for the face screen.
  get FONT() {
    return this.fontCache || (this.fontCache = {
      A: ['.#.', '#.#', '###', '#.#', '#.#'], C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
      E: ['###', '#..', '##.', '#..', '###'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
      K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'], M: ['#.#', '###', '###', '#.#', '#.#'],
      N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
      T: ['###', '.#.', '.#.', '.#.', '.#.'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'], Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
      ' ': ['...', '...', '...', '...', '...']
    });
  }
  // Hand-drawn extras at the same 4 px scale: cat (walking, standing, leaping), wing (two flaps).
  get ART() { return this.artCache || (this.artCache = {
      catWalkA: ['..K.K.........K.', '.KoKoK.......KoK', '.KooooK.....KoK.', 'KoEoooKKKKKKKoK.', 'KPwooooooooooK..', '.KwwoooodddooK..', '..KoooooooooK...', '..KooKKKKKooK...', '.KooK.....KooK..', '..KK.......KK...'],
      catWalkB: ['..K.K.........K.', '.KoKoK.......KoK', '.KooooK.....KoK.', 'KoEoooKKKKKKKoK.', 'KPwooooooooooK..', '.KwwoooodddooK..', '..KoooooooooK...', '...KooKKKooK....', '...KooK.KooK....', '....KK...KK.....'],
      wingUp: ['..KKKKK.KKKK..', '..KwwgwKwwwK..', '.KwwwgwwwwK...', '.KwwgwwwwK....', 'KwwgwwwgK.K...', 'KwgwwggwwKwK..', 'KgwggwwwwwwK..', 'KggggggggKK...', 'KwwwwwwwK.....', 'KKKKwwwwK.....', '....KKKKK.....', '..............', '..............', '..............', '..............', '..............', '..............'],
      wingDown: ['..............', '..........KK..', '........KKwwK.', '......KKwwwwK.', '....KKwwwwwgK.', '..KKwwwggggwK.', 'KKwwgggwwwwwwK', 'KgggwwwwwwwwwK', 'KggggggggggKKK', 'KwgggwwwwwK...', '.KwwgggwwwwK..', '..KKwwggKKwK..', '....KwwK..K...', '.....KK.......', '..............', '..............', '..............'],
      catStand: ['..K.K...........', '.KoKoK........K.', '.KooooK......KoK', 'KoEoooKKKKKKKoK.', 'KPwooooooooooK..', '.KwwoooodddooK..', '..KoooooooooK...', '...KooKKKooK....', '...KooK.KooK....', '....KK...KK.....'],
      catLeap: ['..K.K...........', '.KoKoK..........', '.KooooK.......K.', 'KoEoooKKKKKKKKoK', 'KPwoooooooooooK.', '.KwwoooodddooK..', 'KoooooooooooooK.', 'KoKKKKKKKKKKKoK.', '.K...........K..']
    }); }
  base() {
    if (this.baseCache) return this.baseCache;
    const rows = [
      '......KKKKKKKKKKKKKKKKKKKKKKKK......',
      '....KK010101333333333434343333KK....',
      '...K0010101333434343444444434343K...',
      '..K000110212232333333344444443333K..',
      '.K00102021223233333344444444434343K.',
      'K0010211122323333333444444443333333K',
      'K0101121223233333343444444444343434K',
      'K1011212132323333334444444433333333K',
      'K0112121323233334344444444434333434K',
      'K1121213232333333444444443333333333K',
      'K1112122323333434444444443433333434K',
      'K1121213233333344444444333333333333K',
      'K1212122323333444444444343433332434K',
      'K2121213233334444444433333333323333K',
      'K1212122333344444444434343333232433K',
      'K2121213333444444444333333332322333K',
      'K1212123333444444443434333333231433K',
      'K2121223343444444433333333332312333K',
      'K1212223344444444343433333333121333K',
      'K2122223344444443333333333331212333K',
      'K1222224444444444343433333312121333K',
      'K2222224444444343333333333221212332K',
      'K1222234444444434343333332212121323K',
      'K2222324444434333333333322121212232K',
      'K2223234444444434333333221212121323K',
      'K2222324444433333333333222121212232K',
      'K2223234444443434333332221212121323K',
      'K2232324443433333333322212121212232K',
      'K2323234324343433333322121212121323K',
      'K3232324232333333333221212121212232K',
      '.K32323232434343333221212121212132K.',
      '..K323232333333333322212121212122K..',
      '...K3232334343333322212121212121K...',
      '....KK232333333332221212121212KK....',
      '......KKKKKKKKKKKKKKKKKKKKKKKK......',
      '........K111111K....K111111K........',
      '........K222222K....K221212K........',
      '........K322222K....K212121K........',
      '........K222212K....K221211K........',
      '........K322121K....K212111K........',
      '.........KKKKKK......KKKKKK.........'
    ];
    const a = new Int8Array(36 * 41);
    rows.forEach((row, y) => {
      for (let x = 0; x < 36; x++) {
        const ch = row[x];
        a[y * 36 + x] = ch === '.' ? -1 : ch === 'K' ? 5 : ch.charCodeAt(0) - 48;
      }
    });
    this.baseCache = a;
    return a;
  }
  eyeShape(name) {
    const S = {
      open: [0, 0, ['.#.', '###', '###', '###', '.#.']],
      half: [0, 2, ['###', '.#.']],
      shut: [0, 3, ['###']],
      happy: [0, 1, ['.#.', '#.#', '#.#']]
    };
    return name === 'none' ? null : S[name] || S.open;
  }
  // A copy of the sprite with eyes stamped in. eyes may be [left, right].
  frame(eyes, dx, dy) {
    const f = this.base().slice();
    const shapes = Array.isArray(eyes) ? eyes : [eyes, eyes];
    [[15, 11], [26, 11]].forEach(([ex, ey], n) => {
      const sh = this.eyeShape(shapes[n]);
      if (!sh) return;
      const [ox, oy, rows] = sh;
      rows.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          if (row[i] !== '#') continue;
          const x = ex + ox + i + (dx || 0), y = ey + oy + j + (dy || 0);
          const k = y * 36 + x;
          if (x >= 0 && x < 36 && y >= 0 && y < 41 && f[k] >= 0 && f[k] < 5) f[k] = 5;
        }
      });
    });
    return f;
  }
  blink(p, at, normal) {
    if (p >= at && p < at + 0.07) return 'half';
    if (p >= at + 0.07 && p < at + 0.17) return 'shut';
    if (p >= at + 0.17 && p < at + 0.24) return 'half';
    return normal;
  }
  glint(f, g, w, amt) {
    for (let y = 0; y < 41; y++) for (let x = 0; x < 36; x++) {
      const k = y * 36 + x, v = f[k];
      if (v >= 0 && v < 5 && Math.abs(x + 0.75 * y - g) < w) f[k] = Math.min(4, v + amt);
    }
  }
  dim(f, n) {
    if (!n) return;
    for (let k = 0; k < f.length; k++) if (f[k] >= 0 && f[k] < 5) f[k] = Math.max(0, f[k] - n);
  }
  // Draws the sprite with its feet on row 49, 36 × 41 at (9, 9) moved by (dx, dy).
  blit(s, f, o) {
    o = o || {};
    const left = 9 + (o.dx || 0), top = 9 + (o.dy || 0), P = this.P;
    for (let r = 0; r < 41; r++) for (let c = 0; c < 36; c++) {
      const v = f[r * 36 + c];
      if (v < 0) continue;
      this.put(s, left + c, top + r, P[v], 1);
    }
  }
  // One rectangle of the sprite, moved by (dx, dy) from its normal place.
  part(s, f, c0, c1, r0, r1, dx, dy) {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const v = f[r * 36 + c];
      if (v >= 0) this.put(s, 9 + c + dx, 9 + r + dy, this.P[v], 1);
    }
  }
  // The face as a small screen (sprite columns 6..31, rows 8..27); returns its inner 24 × 18 box.
  screen(s) {
    const x0 = 15, y0 = 17;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 26; x++) {
      if ((x === 0 || x === 25) && (y === 0 || y === 19)) continue;
      const edge = x === 0 || x === 25 || y === 0 || y === 19;
      this.put(s, x0 + x, y0 + y, edge ? this.P[5] : y % 3 === 2 ? this.C.scan : this.C.screen, 1);
    }
    return { x: x0 + 1, y: y0 + 1, w: 24, h: 18 };
  }
  // Draws a coloured bitmap; flip mirrors it, cols shows only that many columns from its attached (left) side.
  art(s, x, y, rows, map, a, flip, cols) {
    rows.forEach((row, j) => {
      const n = row.length;
      for (let i = 0; i < n; i++) {
        if (cols != null && i >= cols) continue;
        const c = map[row[i]];
        if (c) this.put(s, flip ? x + n - 1 - i : x + i, y + j, c, a);
      }
    });
  }

  /* ── small pixel helpers ── */

  ease(x) {
    const s = Math.max(0, Math.min(1, x));
    return s * s * (3 - 2 * s);
  }
  // Opacity is dithered to four levels, the same way as every other pixel effect. Nothing leaves the square.
  put(s, x, y, c, a) {
    if (x < 0 || y < 0 || x >= s.W || y >= s.H) return;
    const q = Math.max(0, Math.min(1, a == null ? 1 : a)) * 4;
    let lv = Math.floor(q);
    if (q - lv > bayer(x, y)) lv++;
    if (lv <= 0) return;
    const f = lv / 4, k = (y * s.W + x) * 4, b = s.buf;
    if (b[k + 3] === 0 || f >= 1) {
      b[k] = c[0]; b[k + 1] = c[1]; b[k + 2] = c[2]; b[k + 3] = f * 255;
      return;
    }
    b[k] = b[k] + (c[0] - b[k]) * f;
    b[k + 1] = b[k + 1] + (c[1] - b[k + 1]) * f;
    b[k + 2] = b[k + 2] + (c[2] - b[k + 2]) * f;
    b[k + 3] = Math.max(b[k + 3], f * 255);
  }
  stamp(s, x, y, rows, c, a) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') this.put(s, x + i, y + j, c, a);
    });
  }
  text(s, x, y, str, c, a) {
    const F = this.FONT;
    for (let n = 0; n < str.length; n++) if (F[str[n]]) this.stamp(s, x + n * 4, y, F[str[n]], c, a);
  }
  shadow(s, cx, w, a) {
    const half = w / 2;
    for (let j = 0; j < 2; j++) {
      const hw = half - j * 3;
      if (hw <= 0) continue;
      for (let x = -Math.floor(hw); x <= hw; x++) this.put(s, cx + x, 50 + j, this.C.dark, a * (1 - Math.pow(x / hw, 2)));
    }
  }
  mix(a, b, f) {
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
}
