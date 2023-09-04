import chalk from "chalk";
import appConfig from "../config/app.config";

const infoMessage = (message: string) => {
  console.log(chalk.bgGreen(message));
};

const errorMessage = (message: string) => {
  return appConfig.SHOW_ERRORS ? console.log(chalk.bgRed.white(message)) : null;
};

const debugMessage = (message: string) => {
  return appConfig.DEBUG_MODE ? console.log(chalk.bgGray.white(message)) : null;
};

export { infoMessage, errorMessage, debugMessage };
