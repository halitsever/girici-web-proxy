import { access } from "node:fs/promises";

const checkDirectory = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
};

export { checkDirectory };
