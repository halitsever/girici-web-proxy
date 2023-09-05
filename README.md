<p align="center">
<img src="https://assets.halit.org/assets/github-repos/repo-thumbnails/girici-thumbnail.png" alt="Girici Web Proxy Node.js, Free, Open Source, Self Host"/>
</p>

<h1 align="center">Step by step installation</h1>

```
npm run install-modules
```

<p align="center">
This command installs all dependencies for front-end & back-end folders
</p>

```
npm run build-all
```

<p align="center">This command builds front-end and back-end</p>

```
npm run start
```

<p align="center">and this command serves express server on specific port (default 3000)</p>

<h1 align="center">Screenshot</h1>

<p align="center">
<img src="https://assets.halit.org/assets/github-repos/screenshots/girici-screenshot.png" alt="Girici Web Proxy Node.js Screenshot"/>
</p>

<h1 align="center">Running on docker</h1>
<p align="center">Running in swarm mode:</p>

```
docker stack deploy -c docker-compose.yml
```

<p align="center">Run with CLI:</p>

```
docker run -d -p 3000:3000 halitsever/girici-web-proxy:latest
```
