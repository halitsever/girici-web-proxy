<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/web/src/assets/brand/girici-icon-dark.svg">
    <img src="packages/web/src/assets/brand/girici-icon.svg" height="120" alt="Girici">
  </picture>
</p>
<h1 align="center">Girici</h1>

<p align="center">
🌐 Web proxy project written in Typescript & Vue.js. Node.js alternative for php-proxy.
<br/>
<br/>
<img src="https://img.shields.io/github/sponsors/halitsever"/> 
  <img src="https://img.shields.io/github/license/halitsever/girici-web-proxy"/> 
</p>
</p>

> **Note:** Girici v1 is no longer maintained. v2, built on its own service worker engine, is being developed on
> `main`. The Docker image tagged `latest` is still v1.

<a align="center">
<img src="https://halitsever-api.vercel.app/api/details"/>
</a>

- 📝 [**Http/Https Support**](#) - http/https protocols are supported
- 🧑‍💻 [**Can run inside docker**](#) - you can run girici inside of container
- 🎨 [**Fancy UI**](#) - looking good ui for surfing on internet without restriction
- 🎨 [**Use internet of server**](#) - you can install girici on server and you can use server's internet as web proxy




## Run from source

Requires Node.js 22.19 or newer (24 LTS recommended).

```
npm ci
npm run build
npm start
```

Girici listens on http://localhost:3000.

<p align="center">
<b>Screenshot</b>
</p>
<p align="center">
<img src="https://assets.halit.org/assets/github-repos/screenshots/girici-screenshot.png" alt="Girici Web Proxy Node.js Screenshot"/>
</p>

## Run with Docker

```
docker run -d -p 3000:3000 halitsever/girici-web-proxy:latest
```

Until v2.0.0 is released, the `latest` image is still v1. To build and run v2 locally:

```
docker compose up --build
```

Service workers need HTTPS outside localhost. To get automatic certificates, point a domain at your server, remove
the `ports` mapping of the `girici` service and run:

```
GIRICI_DOMAIN=proxy.example.com docker compose --profile https up -d --build
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. `LISTENER_PORT` is accepted as an alias. |
| `HOST` | `0.0.0.0` | Interface to bind. |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug`. |
| `SOURCE_URL` | this repository | Where the UI's source code link points. |
| `GIRICI_YT_POTOKEN` | `on` | Mint YouTube GVS poTokens server-side to help video playback. Set `off` to disable. |

## Known limitations

YouTube guards video with its SABR streaming and poToken bot protection. Girici mints a GVS poToken server-side
(`GIRICI_YT_POTOKEN`) and steers the player toward direct streams, which plays many videos, but YouTube still blocks
sustained playback of some, especially from datacenter IPs. A residential egress helps. This stays fragile: a YouTube
change can break it until the token path is updated.





<a align="center" href="https://github.com/halitsever/girici-web-proxy/issues">
<img src="https://halitsever-api.vercel.app/api/issue"/>
</a>

<a align="center">
<img src="https://halitsever-api.vercel.app/api/sponsor"/>
</a>

## License

Copyright (C) 2021-2026 Halit Sever

Girici is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public
License, version 3, as published by the Free Software Foundation. See [LICENSE](LICENSE).

If you run a modified version of Girici as a network service, the AGPL requires you to offer its users the source
code of your version. Set `SOURCE_URL` to point to it; the UI links there.
