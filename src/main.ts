import "./styles.css";
import { isTauri } from "./platform/files";
import { App } from "./ui/app";

const root = document.getElementById("app")!;
const app = new App(root);
// A handle for debugging from the browser console, and for the end-to-end tests.
(window as unknown as { cardGrader: App }).cardGrader = app;

// Offline support for the web version. The desktop app loads its files from
// disk, so a service worker there would only get in the way.
if (!isTauri() && "serviceWorker" in navigator && import.meta.env.PROD) {
  import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true }));
}
