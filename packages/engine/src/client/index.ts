import { install } from "./runtime.ts";

// The tag would otherwise show up in the page's own DOM queries.
document.currentScript?.remove();
install(window);
