<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { withBase } from "vitepress";

const repo = "https://github.com/halitsever/girici-web-proxy";
const command = "docker run -d -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest";

const examples = [
  { scheme: "https", rest: "en.wikipedia.org/wiki/Istanbul" },
  { scheme: "https", rest: "www.youtube.com/watch?v=jNQXAC9IVRw" },
  { scheme: "http", rest: "info.cern.ch/hypertext/WWW/TheProject.html" },
  { scheme: "https", rest: "web.archive.org/web/1998/google.com" },
  { scheme: "https", rest: "github.com/halitsever/girici-web-proxy" },
];
const packets = ["wikipedia.org", "youtube.com", "info.cern.ch", "archive.org", "reddit.com", "github.com"];

const doorSteps = ["You type an address.", "It goes through the door.", "It comes out on your own server."];

const shots = [
  {
    src: "/screenshot.png",
    alt: "The Girici browse screen with an address field and tiles for recent sites, each with its own icon",
    title: "Browse",
    text: "Type an address or a search, or pick up a recent site with one click.",
  },
  {
    src: "/screenshot-settings.png",
    alt: "Girici settings split into Browsing, Privacy and data, and Admin sections",
    title: "Settings",
    text: "Language, search engine, cookies and history for you; access, branding and blocked sites for the admin.",
  },
  {
    src: "/screenshot-signin.png",
    alt: "The Girici sign-in screen with the logo's ring and route beside the form",
    title: "Sign-in",
    text: "Private by default. Open it to the public when you want, and visitors get a short introduction first.",
  },
];

const stops = [
  {
    name: "Your tab",
    text: "You open a site from Girici. Its address becomes /~/https/site/, so links, imports and fonts resolve on their own.",
  },
  {
    name: "Service worker",
    text: "Catches every request the page makes and rewrites its HTML, CSS and JavaScript, right in your browser.",
  },
  {
    name: "Girici server",
    text: "Relays the bytes. It refuses private and loopback addresses, so nobody can use it to reach your network.",
  },
  {
    name: "The site",
    text: "Sees a visitor on your server's connection, wherever you deploy it.",
  },
];

const defaults = [
  {
    name: "Sign-in gate",
    text: "One admin account, created on first run with a code from the server log. Nobody browses signed out.",
  },
  { name: "SSRF guard", text: "Private, loopback and link-local addresses are refused before a connection opens." },
  { name: "CSRF checks", text: "Requests that change state have to come from Girici's own pages." },
  {
    name: "Rate limits",
    text: "Sign-in attempts and proxy traffic are capped per visitor, with an optional bandwidth cap.",
  },
  { name: "Quiet logs", text: "Visited addresses, cookies and credentials stay out of the logs." },
  { name: "Small image", text: "A distroless runtime with no shell, running as an unprivileged user." },
];

const current = ref(0);
const swapping = ref(false);
const copied = ref(false);
/** Scroll-driven scenes run only with motion allowed; otherwise every scene shows its end state at rest. */
const live = ref(false);
const doorStep = ref(0);
const shotStep = ref(0);
const root = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;
let stopScenes: (() => void) | undefined;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Hands each scene its scroll progress as --p, from 0 to 1. A pinned scene counts while its stage is stuck to the
 * viewport, any other while it crosses the viewport.
 */
function watchScenes(container: HTMLElement): () => void {
  const scenes = Array.from(container.querySelectorAll<HTMLElement>("[data-scene]"));
  let frame = 0;
  const update = () => {
    frame = 0;
    const height = window.innerHeight;
    for (const scene of scenes) {
      const box = scene.getBoundingClientRect();
      const p =
        scene.dataset.scene === "pin"
          ? clamp(-box.top / Math.max(1, box.height - height))
          : clamp((height - box.top) / (height + box.height));
      scene.style.setProperty("--p", p.toFixed(4));
      if (scene.dataset.name === "door") doorStep.value = p < 0.34 ? 0 : p < 0.64 ? 1 : 2;
      if (scene.dataset.name === "shots") shotStep.value = Math.min(shots.length - 1, Math.floor(p * shots.length));
    }
  };
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  update();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
  };
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !root.value) return;
  live.value = true;
  stopScenes = watchScenes(root.value);
  timer = setInterval(() => {
    swapping.value = true;
    setTimeout(() => {
      current.value = (current.value + 1) % examples.length;
      swapping.value = false;
    }, 260);
  }, 3400);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  stopScenes?.();
});

async function copy() {
  try {
    await navigator.clipboard.writeText(command);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <div ref="root" class="gl" :class="{ live }">
    <section class="hero">
      <div class="hero-copy">
        <h1 class="hero-title">Every site, through one door.</h1>
        <p class="hero-lead">
          Girici is a self-hosted web proxy that runs on Node.js. A service worker in your browser rewrites each page,
          and your server only relays the bytes.
        </p>

        <div
          class="rewrite"
          :class="{ swapping }"
          aria-label="Girici rewrites a site's address into a path on your own server"
        >
          <div class="rewrite-row">
            <span class="rewrite-tag">You type</span>
            <code class="rewrite-url">{{ examples[current].scheme }}://{{ examples[current].rest }}</code>
          </div>
          <div class="rewrite-row">
            <span class="rewrite-tag">Girici opens</span>
            <code class="rewrite-url"
              ><span class="rewrite-host">proxy.example</span
              ><span class="rewrite-route">/~/{{ examples[current].scheme }}/</span>{{ examples[current].rest }}</code
            >
          </div>
        </div>

        <div class="actions">
          <a class="btn btn-primary" :href="withBase('/guide/getting-started')">Get started</a>
          <a class="btn" :href="withBase('/guide/how-it-works')">How it works</a>
          <a class="btn btn-quiet" :href="repo" target="_blank" rel="noopener">GitHub</a>
        </div>
      </div>

      <div class="door" aria-hidden="true">
        <div class="route">
          <span v-for="(packet, index) in packets" :key="packet" class="packet" :style="{ '--i': index }">{{
            packet
          }}</span>
        </div>
        <svg class="ring" viewBox="0 0 64 64">
          <path d="M30 6A26 26 0 1 0 55.3 38H44.83A16 16 0 1 1 30 16Z" />
        </svg>
      </div>
      <span class="scroll-cue" aria-hidden="true" />
    </section>

    <!-- Pinned: one address travels along the route, through the ring, and out as a path on your server. -->
    <section class="scene door-scene" data-scene="pin" data-name="door">
      <div class="stage">
        <ol class="captions">
          <li v-for="(caption, index) in doorSteps" :key="caption" :class="{ on: doorStep === index }">
            {{ caption }}
          </li>
        </ol>
        <div class="big-door" aria-hidden="true">
          <span class="big-route"><code class="addr addr-in">https://en.wikipedia.org/wiki/Istanbul</code></span>
          <svg class="big-ring" viewBox="0 0 64 64">
            <path d="M30 6A26 26 0 1 0 55.3 38H44.83A16 16 0 1 1 30 16Z" />
          </svg>
          <code class="addr addr-out"
            ><span class="addr-host">proxy.example</span
            ><span class="addr-route">/~/https/</span>en.wikipedia.org/wiki/Istanbul</code
          >
        </div>
      </div>
    </section>

    <!-- Pinned: the app itself, one screen per stretch of scroll. -->
    <section class="scene shots-scene" data-scene="pin" data-name="shots">
      <div class="stage">
        <div class="shots-copy">
          <h2 class="h2">Built to be opened every day.</h2>
          <ol class="shot-list">
            <li v-for="(shot, index) in shots" :key="shot.title" :class="{ on: shotStep === index }">
              <span class="shot-dot" aria-hidden="true" />
              <h3>{{ shot.title }}</h3>
              <p>{{ shot.text }}</p>
            </li>
          </ol>
        </div>
        <div class="shots">
          <figure
            v-for="(shot, index) in shots"
            :key="shot.src"
            class="shot"
            :class="{ on: shotStep === index, past: shotStep > index }"
          >
            <img :src="withBase(shot.src)" width="1440" height="860" :alt="shot.alt" loading="lazy" />
          </figure>
        </div>
      </div>
    </section>

    <section class="section route-scene" data-scene="view">
      <h2 class="h2">The route a request takes</h2>
      <p class="lead">Rewriting happens in your browser. The server never parses a page, it moves bytes.</p>
      <ol class="line">
        <li v-for="(stop, index) in stops" :key="stop.name" class="stop" :style="{ '--i': index }">
          <span class="stop-mark" />
          <h3 class="stop-name">{{ stop.name }}</h3>
          <p class="stop-text">{{ stop.text }}</p>
        </li>
      </ol>
    </section>

    <section class="section defaults-scene" data-scene="view">
      <h2 class="h2">Safe before you touch a setting</h2>
      <p class="lead">
        A fresh instance is private, guarded and quiet. Every limit can be tuned with an environment variable.
      </p>
      <dl class="defaults">
        <div v-for="(item, index) in defaults" :key="item.name" class="default" :style="{ '--i': index }">
          <dt>{{ item.name }}</dt>
          <dd>{{ item.text }}</dd>
        </div>
      </dl>
    </section>

    <section class="section">
      <h2 class="h2">Two ways to run it</h2>
      <div class="modes">
        <div class="mode">
          <h3 class="mode-name">Single origin</h3>
          <code class="mode-url"><span class="mode-host">proxy.example</span>/~/https/wikipedia.org/</code>
          <p>The default. One host and one certificate. Girici keeps sites apart in JavaScript.</p>
        </div>
        <div class="mode">
          <h3 class="mode-name">Subdomain mode</h3>
          <code class="mode-url"><span class="mode-host">k3f9a2.proxy.example</span>/~/https/wikipedia.org/</code>
          <p>
            Each site gets a host of its own, so the browser's same-origin rule keeps sites apart.
            <a :href="withBase('/guide/subdomain-mode')">Set up subdomain mode</a>
          </p>
        </div>
      </div>
    </section>

    <section class="section closing" data-scene="view">
      <svg class="closing-ring" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M30 6A26 26 0 1 0 55.3 38H44.83A16 16 0 1 1 30 16Z" />
        <rect width="38" height="8" x="24" y="26" />
      </svg>
      <h2 class="closing-title">Open the door.</h2>
      <div class="terminal">
        <code class="terminal-line"><span class="terminal-prompt">$</span>{{ command }}</code>
        <button type="button" class="terminal-copy" @click="copy">{{ copied ? "Copied" : "Copy" }}</button>
      </div>
      <p class="closing-note">
        Then open port 3000 and create the admin account with the code Girici prints to its log.
      </p>
      <p class="closing-note">
        Coming from php-proxy? <a :href="withBase('/guide/php-proxy-alternative')">See how the two compare</a>.
      </p>
      <div class="actions">
        <a class="btn btn-primary" :href="withBase('/guide/getting-started')">Get started</a>
        <a class="btn" :href="withBase('/guide/docker')">Run with Docker</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gl {
  --blue: #3d6bff;
  --signal: #6e90ff;
  --midnight: #0a0f1e;
  --deep: #060913;
  --paper: #fafafa;
  --zinc: #a1a1aa;
  --dim: #71717a;
  --line: #27272a;
  --gutter: max(24px, calc((100vw - 1200px) / 2));
  color: var(--paper);
  overflow-x: clip;
}

/* Hero: the logo's ring is the door, its bar the route every address travels. */
.hero {
  --s: clamp(300px, 40vw, 560px);
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--s);
  align-items: center;
  gap: 48px;
  min-height: calc(100svh - var(--vp-nav-height));
  padding: 48px var(--gutter) 96px;
}

.hero-title {
  font-size: clamp(44px, 7vw, 96px);
  font-weight: 650;
  line-height: 0.98;
  letter-spacing: -0.045em;
  max-width: 11ch;
  margin: 0;
}

.hero-lead {
  margin: 28px 0 0;
  max-width: 46ch;
  font-size: clamp(17px, 1.6vw, 20px);
  line-height: 1.55;
  color: var(--zinc);
}

.rewrite {
  margin-top: 36px;
  display: grid;
  gap: 10px;
  max-width: 100%;
}
.rewrite-row {
  display: grid;
  grid-template-columns: 7.5em minmax(0, 1fr);
  align-items: baseline;
  gap: 16px;
}
.rewrite-tag {
  font-size: 13px;
  color: var(--dim);
}
.rewrite-url {
  font-family: var(--vp-font-family-mono);
  font-size: clamp(13px, 1.25vw, 15px);
  color: var(--zinc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition:
    opacity 0.26s ease,
    transform 0.26s ease;
}
.rewrite-row + .rewrite-row .rewrite-url {
  color: var(--paper);
  transition-delay: 0.08s;
}
.rewrite.swapping .rewrite-url {
  opacity: 0;
  transform: translateY(-4px);
}
.rewrite-host {
  color: var(--paper);
}
.rewrite-route {
  color: var(--signal);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 40px;
}
.btn {
  display: inline-flex;
  align-items: center;
  height: 46px;
  padding: 0 22px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: #111113;
  color: var(--paper);
  font-size: 15px;
  font-weight: 550;
  text-decoration: none;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease;
}
.btn:hover {
  border-color: #3f3f46;
  background: #18181b;
}
.btn-primary {
  background: var(--paper);
  border-color: transparent;
  color: var(--midnight);
}
.btn-primary:hover {
  background: #fff;
  border-color: transparent;
}
.btn-quiet {
  background: transparent;
  border-color: transparent;
  color: var(--zinc);
}
.btn-quiet:hover {
  background: transparent;
  border-color: transparent;
  color: var(--paper);
}
.btn:focus-visible,
.terminal-copy:focus-visible,
.mode a:focus-visible {
  outline: 2px solid var(--signal);
  outline-offset: 3px;
}

/* Positions follow the 64-unit logo: ring centred at 30, bar from x 24 at y 26 to 34. */
.door {
  position: relative;
  width: var(--s);
  height: var(--s);
}
.ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  fill: var(--paper);
  z-index: 2;
  filter: drop-shadow(0 30px 80px rgba(61, 107, 255, 0.18));
}
.route {
  position: absolute;
  top: calc(var(--s) * 26 / 64);
  left: calc(var(--s) * 24 / 64);
  /* Out to the viewport's right edge, past the hero's gutter. */
  width: calc(var(--s) * 40 / 64 + var(--gutter));
  height: calc(var(--s) * 8 / 64);
  background: var(--blue);
  overflow: hidden;
  container-type: inline-size;
  z-index: 1;
  transform-origin: right center;
}
.packet {
  position: absolute;
  top: 50%;
  left: 0;
  font-family: var(--vp-font-family-mono);
  font-size: clamp(12px, 1.1vw, 15px);
  color: var(--midnight);
  white-space: nowrap;
  transform: translate(calc(var(--i) * 16cqw + 4cqw), -50%);
}

@media (prefers-reduced-motion: no-preference) {
  .hero-copy > * {
    animation: rise 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .hero-copy > :nth-child(2) {
    animation-delay: 0.08s;
  }
  .hero-copy > :nth-child(3) {
    animation-delay: 0.16s;
  }
  .hero-copy > :nth-child(4) {
    animation-delay: 0.24s;
  }
  .ring {
    animation: turn-in 1.1s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .route {
    animation: extend 0.9s cubic-bezier(0.6, 0, 0.2, 1) 0.35s both;
  }
  .packet {
    opacity: 0;
    animation: travel 12s linear infinite;
    animation-delay: calc(1.2s + var(--i) * 2s);
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
}
@keyframes turn-in {
  from {
    opacity: 0;
    transform: rotate(-35deg) scale(0.92);
  }
}
@keyframes extend {
  from {
    transform: scaleX(0);
  }
}
/* Addresses arrive from the open web on the right and disappear into the door. */
@keyframes travel {
  0% {
    opacity: 0;
    transform: translate(100cqw, -50%);
  }
  4% {
    opacity: 1;
  }
  44% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
    transform: translate(0, -50%);
  }
}

/* Product: the screenshot settles flat as it scrolls into view. */
.product {
  padding: 0 var(--gutter) 40px;
  perspective: 1600px;
}
.product-frame {
  margin: 0 auto;
  max-width: 1200px;
  border-radius: 18px;
  border: 1px solid var(--line);
  overflow: hidden;
  box-shadow:
    0 60px 120px -40px rgba(61, 107, 255, 0.35),
    0 30px 60px -30px rgba(0, 0, 0, 0.8);
}
.product-frame img {
  display: block;
  width: 100%;
  height: auto;
}
.product-caption {
  margin: 28px auto 0;
  max-width: 60ch;
  text-align: center;
  color: var(--zinc);
  font-size: 16px;
  line-height: 1.6;
}
@media (prefers-reduced-motion: no-preference) {
  @supports (animation-timeline: view()) {
    .product-frame {
      animation: settle linear both;
      animation-timeline: view();
      animation-range: entry 0% cover 45%;
    }
  }
}
@keyframes settle {
  from {
    transform: rotateX(24deg) scale(0.9) translateY(40px);
    opacity: 0.4;
  }
}

/* Scenes read their scroll progress from --p; at rest, and without motion, they sit at their end state. */
[data-scene] {
  --p: 1;
}

.scroll-cue {
  position: absolute;
  left: 50%;
  bottom: 28px;
  width: 2px;
  height: 52px;
  background: linear-gradient(var(--blue), transparent);
  transform-origin: top;
}
.live .scroll-cue {
  animation: cue 1.8s ease-in-out infinite;
}
@keyframes cue {
  from {
    transform: scaleY(0);
    opacity: 1;
  }
  to {
    transform: scaleY(1);
    opacity: 0;
  }
}

/* Pinned scenes: a tall section whose stage sticks to the viewport while the scroll plays it. */
.scene {
  position: relative;
}
.stage {
  padding: 120px var(--gutter) 0;
}
.live .door-scene {
  height: 320vh;
}
.live .shots-scene {
  height: 340vh;
}
.live .stage {
  position: sticky;
  top: var(--vp-nav-height);
  height: calc(100svh - var(--vp-nav-height));
  padding: 0 var(--gutter);
  overflow: hidden;
}

/* The door scene. Positions follow the 64-unit logo, as in the hero. */
.door-scene .stage {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: clamp(32px, 7vh, 72px);
  text-align: center;
}
.captions {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.captions li {
  margin: 0;
  font-size: clamp(30px, 5vw, 64px);
  font-weight: 650;
  line-height: 1.05;
  letter-spacing: -0.045em;
}
.live .captions li {
  grid-area: 1 / 1;
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 0.5s ease,
    transform 0.6s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.live .captions li.on {
  opacity: 1;
  transform: none;
}
.big-door {
  --d: min(40vh, 62vw);
  /* In, turn, out: each part of the scroll moves one piece. */
  --a: clamp(0, calc(var(--p) / 0.36), 1);
  --r: clamp(0, calc((var(--p) - 0.36) / 0.26), 1);
  --o: clamp(0, calc((var(--p) - 0.62) / 0.26), 1);
  position: relative;
  width: var(--d);
  height: var(--d);
  margin-bottom: 72px;
}
.big-ring {
  position: absolute;
  inset: 0;
  z-index: 2;
  fill: var(--paper);
  transform-origin: 46.875% 46.875%;
  transform: rotate(calc(var(--r) * -360deg));
  filter: drop-shadow(0 30px 90px rgba(61, 107, 255, 0.25));
}
.big-route {
  position: absolute;
  top: calc(var(--d) * 26 / 64);
  left: calc(var(--d) * 24 / 64);
  z-index: 1;
  width: 100vw;
  height: calc(var(--d) * 8 / 64);
  background: var(--blue);
  overflow: hidden;
  box-shadow: 0 0 calc(var(--r) * 60px) rgba(61, 107, 255, calc(var(--r) * 0.9));
}
.addr {
  font-family: var(--vp-font-family-mono);
  font-size: clamp(12px, 1.5vw, 19px);
  white-space: nowrap;
}
.addr-in {
  position: absolute;
  top: 50%;
  left: 0;
  color: var(--midnight);
  font-weight: 600;
  /* The route clips it where it starts, inside the ring, so the address disappears through the door. */
  translate: calc((1 - var(--a)) * 48vw - var(--a) * 100%) -50%;
}
.addr-out {
  position: absolute;
  top: calc(100% + 28px);
  left: 50%;
  padding: 12px 18px;
  border: 1px solid #1c2440;
  border-radius: 12px;
  background: var(--deep);
  color: var(--zinc);
  opacity: var(--o);
  translate: -50% calc((1 - var(--o)) * -90px);
  scale: calc(0.7 + var(--o) * 0.3);
  box-shadow: 0 20px 60px -20px rgba(61, 107, 255, calc(var(--o) * 0.6));
}
.addr-host {
  color: var(--paper);
}
.addr-route {
  color: var(--signal);
}

/* The product scene: one screen per stretch of scroll, its caption lit on a small route. */
.shots-scene .stage {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.7fr);
  align-items: center;
  gap: clamp(32px, 5vw, 72px);
}
.shot-list {
  position: relative;
  display: grid;
  gap: 28px;
  margin: 44px 0 0;
  padding: 0 0 0 30px;
  list-style: none;
}
.shot-list::before,
.shot-list::after {
  content: "";
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: 6px;
  width: 3px;
  border-radius: 3px;
  background: #1c2440;
}
.shot-list::after {
  background: var(--blue);
  transform-origin: top;
  transform: scaleY(var(--p));
}
.shot-list li {
  position: relative;
  margin: 0;
  transition: opacity 0.4s ease;
}
.live .shot-list li {
  opacity: 0.35;
}
.live .shot-list li.on {
  opacity: 1;
}
.shot-dot {
  position: absolute;
  top: 3px;
  left: -30px;
  z-index: 1;
  width: 15px;
  height: 15px;
  box-sizing: border-box;
  border: 3px solid #3a4568;
  border-radius: 50%;
  background: var(--midnight);
  transition:
    border-color 0.3s ease,
    box-shadow 0.3s ease;
}
.shot-list li.on .shot-dot {
  border-color: var(--paper);
  box-shadow: 0 0 0 5px rgba(61, 107, 255, 0.3);
}
.shot-list h3 {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.shot-list p {
  margin: 6px 0 0;
  max-width: 36ch;
  font-size: 15px;
  line-height: 1.55;
  color: var(--zinc);
}
.shots {
  position: relative;
  aspect-ratio: 1440 / 860;
  perspective: 1800px;
}
.shot {
  position: absolute;
  inset: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid #1c2440;
  border-radius: 16px;
  box-shadow:
    0 60px 120px -40px rgba(61, 107, 255, 0.4),
    0 30px 60px -30px rgba(0, 0, 0, 0.8);
}
.shot img {
  display: block;
  width: 100%;
  height: auto;
}
.live .shot {
  opacity: 0;
  transform: translateY(70px) rotateX(14deg) scale(0.94);
  transition:
    opacity 0.6s ease,
    transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.live .shot.on {
  opacity: 1;
  transform: none;
}
.live .shot.past {
  opacity: 0;
  transform: translateY(-50px) scale(0.96);
}
.gl:not(.live) .shots {
  display: grid;
  gap: 24px;
  aspect-ratio: auto;
}
.gl:not(.live) .shot {
  position: static;
}

/* The route draws itself across the screen and lights its stops in order. */
.live .route-scene .line::before {
  transform-origin: left center;
  transform: scaleX(clamp(0, calc((var(--p) - 0.18) / 0.3), 1));
}
.live .route-scene .stop,
.live .defaults-scene .default {
  --k: clamp(0, calc((var(--p) - 0.18 - var(--i) * 0.07) * 9), 1);
  opacity: calc(0.12 + var(--k) * 0.88);
  translate: 0 calc((1 - var(--k)) * 28px);
}
.live .defaults-scene .default {
  --k: clamp(0, calc((var(--p) - 0.16 - var(--i) * 0.035) * 9), 1);
}
.live .route-scene .stop-mark {
  box-shadow: 0 0 0 calc(var(--k) * 6px) rgba(61, 107, 255, 0.3);
}

/* The closing ring turns into place as the page ends. */
.closing {
  position: relative;
  overflow: hidden;
}
.closing > :not(.closing-ring) {
  position: relative;
  z-index: 1;
}
.closing-ring {
  position: absolute;
  top: 40px;
  left: 50%;
  width: min(86vw, 760px);
  fill: rgba(250, 250, 250, 0.04);
  translate: -50% 0;
  rotate: calc((1 - var(--p)) * -220deg);
  scale: calc(0.8 + var(--p) * 0.25);
  pointer-events: none;
}
.closing-ring rect {
  fill: rgba(61, 107, 255, 0.16);
}

.section {
  padding: 140px var(--gutter) 0;
}
.h2 {
  margin: 0;
  max-width: 18ch;
  font-size: clamp(32px, 4.4vw, 56px);
  font-weight: 650;
  line-height: 1.04;
  letter-spacing: -0.035em;
  border: 0;
  padding: 0;
}
.lead {
  margin: 20px 0 0;
  max-width: 52ch;
  font-size: 18px;
  line-height: 1.6;
  color: var(--zinc);
}

/* The route as a transit line: stops in order, joined by the brand's blue bar. */
.line {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 32px;
  margin: 72px 0 0;
  padding: 0;
  list-style: none;
}
.line::before {
  content: "";
  position: absolute;
  top: 11px;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--blue);
}
.stop {
  position: relative;
  margin: 0;
}
.stop-mark {
  display: block;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 6px solid var(--paper);
  background: var(--midnight);
  position: relative;
}
.stop-name {
  margin: 28px 0 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.stop-text {
  margin: 10px 0 0;
  font-size: 15px;
  line-height: 1.6;
  color: var(--zinc);
  max-width: 32ch;
}

.defaults {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 56px 48px;
  margin: 72px 0 0;
}
.default dt {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.default dt::before {
  content: "";
  display: block;
  width: 28px;
  height: 4px;
  margin-bottom: 18px;
  background: var(--blue);
}
.default dd {
  margin: 10px 0 0;
  font-size: 15px;
  line-height: 1.6;
  color: var(--zinc);
  max-width: 36ch;
}

.modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  margin-top: 56px;
  border-top: 1px solid var(--line);
}
.mode {
  padding: 36px 40px 8px 0;
}
.mode + .mode {
  padding-left: 40px;
  border-left: 1px solid var(--line);
}
.mode-name {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.mode-url {
  display: block;
  margin-top: 20px;
  font-family: var(--vp-font-family-mono);
  font-size: clamp(14px, 1.5vw, 18px);
  color: var(--dim);
  overflow-wrap: anywhere;
}
.mode-host {
  color: var(--signal);
}
.mode p {
  margin: 20px 0 0;
  font-size: 16px;
  line-height: 1.6;
  color: var(--zinc);
  max-width: 42ch;
}
.mode a {
  display: block;
  margin-top: 12px;
  color: var(--paper);
  font-weight: 550;
  text-decoration: underline;
  text-decoration-color: var(--blue);
  text-underline-offset: 4px;
}

.closing {
  padding-bottom: 160px;
  text-align: center;
}
.closing-title {
  margin: 0;
  font-size: clamp(56px, 11vw, 160px);
  font-weight: 650;
  line-height: 0.95;
  letter-spacing: -0.055em;
}
.terminal {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 860px;
  margin: 56px auto 0;
  padding: 10px 10px 10px 24px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--deep);
  text-align: left;
}
.terminal-line {
  flex: 1;
  min-width: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  color: var(--paper);
  white-space: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
}
.terminal-prompt {
  color: var(--signal);
  margin-right: 12px;
  user-select: none;
}
.terminal-copy {
  flex: none;
  height: 38px;
  padding: 0 16px;
  border-radius: 9px;
  background: var(--paper);
  color: var(--midnight);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  min-width: 82px;
}
.closing-note {
  margin: 20px auto 0;
  max-width: 52ch;
  color: var(--zinc);
  font-size: 15px;
  line-height: 1.6;
}
.closing .actions {
  justify-content: center;
}

@media (max-width: 960px) {
  .hero {
    --s: min(64vw, 320px);
    grid-template-columns: minmax(0, 1fr);
    min-height: auto;
    padding-top: 24px;
  }
  .door {
    order: -1;
  }
  .shots-scene .stage {
    grid-template-columns: minmax(0, 1fr);
    align-content: center;
    gap: 28px;
  }
  .shot-list {
    margin-top: 20px;
    gap: 14px;
  }
  .live .shot-list li:not(.on) p {
    display: none;
  }
  .route {
    width: calc(100vw - var(--gutter) - var(--s) * 24 / 64);
  }
  .line,
  .defaults {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .line::before {
    display: none;
  }
}

@media (max-width: 640px) {
  .gl {
    --gutter: 20px;
  }
  .section {
    padding-top: 96px;
  }
  .rewrite-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  /* Fewer addresses on the shorter route, so they never overlap. */
  .packet {
    font-size: 11px;
    animation-delay: calc(1.2s + var(--i) * 3s);
  }
  .packet:nth-child(n + 5) {
    display: none;
  }
  .line,
  .defaults,
  .modes {
    grid-template-columns: minmax(0, 1fr);
  }
  /* Vertical on phones: the line runs down the left edge through each stop. */
  .line {
    gap: 36px;
    padding-left: 44px;
  }
  .line::before {
    display: block;
    top: 0;
    bottom: 0;
    left: 11px;
    right: auto;
    width: 4px;
    height: auto;
  }
  .live .route-scene .line::before {
    transform-origin: center top;
    transform: scaleY(clamp(0, calc((var(--p) - 0.12) / 0.4), 1));
  }
  .scroll-cue {
    display: none;
  }
  .addr-out {
    width: max-content;
    max-width: calc(100vw - 40px);
    box-sizing: border-box;
    font-size: 12px;
    white-space: normal;
    overflow-wrap: anywhere;
    text-align: center;
  }
  .stop-mark {
    position: absolute;
    left: -44px;
    top: 0;
  }
  .stop-name {
    margin-top: 0;
  }
  .mode,
  .mode + .mode {
    padding: 28px 0 0;
    border-left: 0;
  }
  .mode + .mode {
    margin-top: 28px;
    border-top: 1px solid var(--line);
  }
  .terminal {
    flex-direction: column;
    align-items: stretch;
    padding: 16px;
  }
}
</style>

<style>
/* The landing scrolls under the nav, so it gets a frosted Midnight once the page leaves the top. */
.Layout:has(.gl) .VPNavBar:not(.top) {
  background-color: rgba(10, 15, 30, 0.78) !important;
  -webkit-backdrop-filter: saturate(140%) blur(14px);
  backdrop-filter: saturate(140%) blur(14px);
}
</style>
