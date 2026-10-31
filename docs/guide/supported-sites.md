# Supported sites

Girici aims to run any site, but sites differ, and many judge the server's IP address before Girici gets a say.
This table records what was seen in testing. Results depend heavily on where the server runs: a home connection
gets much further than a datacenter IP.

| Site | Status | Notes |
|------|--------|-------|
| Wikipedia | Works | Reading and navigation are covered by the smoke test. |
| Google Search | Works | Google sends many datacenter IPs to its "unusual traffic" CAPTCHA, with or without a proxy. |
| reCAPTCHA | Works | The widget loads and its challenge opens. Whether you pass depends on the IP. |
| YouTube | Partly | Pages and many videos play, helped by server-side poTokens. Some videos stop after about a minute, more often from datacenter IPs. |
| Instagram | Partly | Logged-out profiles rendered in early testing. Sign-in was not verified. |
| Reddit | Partly | Renders, but datacenter IPs get bot challenges and redirects to sign-in. |
| X (Twitter) | Blocked by the site | Refuses datacenter IPs with 403. |
| Discord | Not verified | Its live updates use WebSockets, which Girici relays. Voice and video need WebRTC, which Girici turns off. |

**Works** means the site loaded and behaved normally in testing. **Partly** means the main pages work with known
gaps. **Blocked by the site** means the site refuses the server, not that Girici failed. **Not verified** means
nobody has tested it end to end yet.

## What does not work anywhere

- **Voice, video calls and peer-to-peer features.** WebRTC is turned off so it cannot connect around the proxy.
- **Sites that need a specific IP or region,** beyond what your server or upstream proxy has.
- **Documents Girici does not rewrite.** XHTML, SVG and XML documents open without their scripts.

## Help fill in this table

Tried a site? Open an issue with the site, your browser, whether the server runs at home or in a datacenter, and
what happened. If a site breaks only through Girici and works directly from the same server, that is a bug we want
to hear about.
