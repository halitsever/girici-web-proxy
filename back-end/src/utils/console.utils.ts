import chalk from "chalk";
import appConfig from "../config/app.config";

const infoMessage = (message: string) => {
  console.log(chalk.bgBlue(message));
};

const errorMessage = (message: string) => {
  return appConfig.SHOW_ERRORS ? console.log(chalk.bgRed(message)) : null;
};

const debugMessage = (message: string) => {
  return appConfig.DEBUG_MODE ? console.log(chalk.bgGray(message)) : null;
};

export { infoMessage, errorMessage, debugMessage };
