import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import appConfig from "./config/app.config";
import { resolve } from 'path'
import { infoMessage, debugMessage, errorMessage } from "./utils/console.utils";
import { checkDirectory } from "./utils/filesystem.utils";

const proxyMiddleware = require("unblocker");
const app = express();

const staticAssetsPath = resolve(appConfig.RELATIVE_FRONT_END_ASSETS_PATH);

app.use('/assets', express.static(staticAssetsPath))

app.get("/", (req: Request, res: Response, next: NextFunction)=> {
  const path = resolve(appConfig.RELATIVE_FRONT_END_DIST_PATH)
  res.sendFile(path)
});

app.use(proxyMiddleware({ prefix: "/proxy/" }));

app.use((req: Request, res: Response, next: NextFunction) => {
  debugMessage(`Request sent! ${req.url}`);
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});


(async function bootstrap() {

  const isDirectoryAvailable = await checkDirectory(appConfig.RELATIVE_FRONT_END_DIST_PATH);

  if (isDirectoryAvailable) {
    app.listen(appConfig.LISTENER_PORT, () => {
      infoMessage(`🚀 App started on ${appConfig.LISTENER_PORT} port`);
      infoMessage(`🛜  You can access girici on http://localhost:${appConfig.LISTENER_PORT}`);
    });
  } else {
    errorMessage(`🚨  Front-end is not builded! Please run 'npm run build-all'`);
  }

})();