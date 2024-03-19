<p align="center" class="logo-section">
<img src="https://raw.githubusercontent.com/halitsever/girici-web-proxy/GIR-1.1.0/resources/images/logo.svg" height="100"/>
</br>
<img src="https://halitsever-api.vercel.app/api/repo-title?title=Girici">

<p align="center">
🌐 Web proxy project written in Typescript & Vue.js. Node.js alternative for php-proxy.
<br/>
<br/>
<img src="https://img.shields.io/github/sponsors/halitsever"/> 
  <img src="https://img.shields.io/github/license/halitsever/girici-web-proxy"/> 
</p>
</p>

<a align="center">
<img src="https://halitsever-api.vercel.app/api/details"/>
</a>

- 🧑‍💻 [**Can run inside container**](#) - you can run girici inside of a docker container
- 🎨 [**Fancy UI**](#) - looking good ui for surfing on internet without restriction
- 🎨 [**Use internet of server**](#) - you can install girici on server and you can use server's internet as web proxy or you can use directly a custom http proxy

<a align="center" >
<img src="https://halitsever-api.vercel.app/api/installation"/>
</a>

<p align="center">
<b>Build & run from source</b>
</p>

```bash
npm run install-modules
```

<p align="center">
This command installs all dependencies for front-end & back-end folders
</p>

```bash
npm run build-all
```

<p align="center">This command builds front-end and back-end</p>

```bash
npm run start
```

<p align="center">and this command serves express server on specific port (default 3000)</p>
<p align="center">
<b>Screenshot</b>
</p>
<p align="center">
<img src="https://i.ibb.co/vPPYkRb/Screenshot-2024-03-19-at-01-03-10.png" alt="Girici Web Proxy Node.js Screenshot"/>
</p>

<p align="center">
<b>Running on docker</b>
</p>
<p align="center">Running in swarm mode:</p>

```bash
docker stack deploy -c docker-compose.yml
```

<p align="center">Run with CLI:</p>

```bash
docker run -d -p 3000:3000 halitsever/girici-web-proxy:latest
```

<a align="center" href="https://github.com/halitsever/girici-web-proxy/issues">
<img src="https://halitsever-api.vercel.app/api/issue"/>
</a>

<a align="center">
<img src="https://halitsever-api.vercel.app/api/sponsor"/>
</a>

<a align="center">
<img src="https://halitsever-api.vercel.app/api/license"/>
</a>

<p align="center">
  MIT License © 2021 <a href="https://www.github.com/halitsever">Halit Sever</a>
</p>
