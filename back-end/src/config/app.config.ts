const appConfig = {
  LISTENER_PORT: process.env.LISTENER_PORT || 3000,
  DEBUG_MODE: process.env.DEBUG || false,
  SHOW_ERRORS: process.env.SHOW_ERRORS || true,
  RELATIVE_FRONT_END_DIST_PATH: "../front-end/dist/index.html",
  RELATIVE_FRONT_END_ASSETS_PATH: "../front-end/dist/assets",
};

export default appConfig;
