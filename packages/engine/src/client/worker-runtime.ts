import { installWorker, type WorkerScope } from "./worker-install.ts";

// globalThis is the worker scope at runtime; typed through WorkerScope to avoid the DOM and WebWorker libs.
installWorker(globalThis as unknown as WorkerScope);
