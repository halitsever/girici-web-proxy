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

const languages = [
  { name: "English", lang: "en" },
  { name: "Türkçe", lang: "tr" },
  { name: "Español", lang: "es" },
  { name: "Português", lang: "pt-BR" },
  { name: "Français", lang: "fr" },
  { name: "Deutsch", lang: "de" },
  { name: "Русский", lang: "ru" },
  { name: "فارسی", lang: "fa", rtl: true },
  { name: "العربية", lang: "ar", rtl: true },
  { name: "简体中文", lang: "zh-CN" },
  { name: "Bahasa Indonesia", lang: "id" },
  { name: "Tiếng Việt", lang: "vi" },
];

const current = ref(0);
const swapping = ref(false);
const copied = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  timer = setInterval(() => {
    swapping.value = true;
    setTimeout(() => {
      current.value = (current.value + 1) % examples.length;
      swapping.value = false;
    }, 260);
  }, 3400);
});
onBeforeUnmount(() => clearInterval(timer));

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
  <div class="gl">
    <section class="hero">
      <div class="hero-copy">
        <h1 class="hero-title">Every site, through one door.</h1>
        <p class="hero-lead">
          Girici is a web proxy you host yourself. A service worker in your browser rewrites each page, and your server
          only relays the bytes.
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
    </section>

    <section class="product">
      <figure class="product-frame">
        <img
          :src="withBase('/screenshot.png')"
          width="1505"
          height="859"
          alt="The Girici browse screen: a search box with suggestions for Wikipedia, YouTube, Reddit and the Internet Archive"
        />
      </figure>
      <p class="product-caption">
        Type an address or a search. Pages open inside Girici with logins, video and WebSockets working, and a small
        toolbar to go back home.
      </p>
    </section>

    <section class="section">
      <h2 class="h2">The route a request takes</h2>
      <p class="lead">Rewriting happens in your browser. The server never parses a page, it moves bytes.</p>
      <ol class="line">
        <li v-for="stop in stops" :key="stop.name" class="stop">
          <span class="stop-mark" />
          <h3 class="stop-name">{{ stop.name }}</h3>
          <p class="stop-text">{{ stop.text }}</p>
        </li>
      </ol>
    </section>

    <section class="section">
      <h2 class="h2">Safe before you touch a setting</h2>
      <p class="lead">
        A fresh instance is private, guarded and quiet. Every limit can be tuned with an environment variable.
      </p>
      <dl class="defaults">
        <div v-for="item in defaults" :key="item.name" class="default">
          <dt>{{ item.name }}</dt>
          <dd>{{ item.text }}</dd>
        </div>
      </dl>
    </section>

    <section class="section languages">
      <h2 class="h2">Speaks twelve languages</h2>
      <p class="lead">
        The interface, the toolbar and every error page follow the browser's language, right to left included.
      </p>
      <p class="tongues">
        <span
          v-for="item in languages"
          :key="item.lang"
          class="tongue"
          :lang="item.lang"
          :dir="item.rtl ? 'rtl' : 'ltr'"
          >{{ item.name }}</span
        >
      </p>
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

    <section class="section closing">
      <h2 class="closing-title">Open the door.</h2>
      <div class="terminal">
        <code class="terminal-line"><span class="terminal-prompt">$</span>{{ command }}</code>
        <button type="button" class="terminal-copy" @click="copy">{{ copied ? "Copied" : "Copy" }}</button>
      </div>
      <p class="closing-note">
        Then open port 3000 and create the admin account with the code Girici prints to its log.
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

.tongues {
  margin: 64px 0 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.15em 0.6em;
  font-size: clamp(30px, 5.2vw, 72px);
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.03em;
}
.tongue {
  color: #3f3f46;
  transition: color 0.25s ease;
}
.tongue:nth-child(3n + 1) {
  color: var(--paper);
}
.tongue:hover {
  color: var(--signal);
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
