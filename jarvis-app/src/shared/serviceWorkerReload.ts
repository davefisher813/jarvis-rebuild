// WHEN A NEW SERVICE WORKER TAKES THE PAGE OVER, RELOAD ONLY IF THIS PAGE WAS
// ALREADY RUNNING UNDER AN OLDER ONE (P0, 2026-10-04).
//
// sw.js calls skipWaiting and clients.claim, so a deploy's new worker becomes
// the page's controller and `controllerchange` fires; reloading then puts the
// person on fresh code instead of a stale shell (main.tsx explains the black
// screen that taught us that). But `controllerchange` ALSO fires on a first
// visit, when the page had no controller at all and the first worker claims it.
// There is no stale shell on a first visit, and the reload it caused landed
// about three seconds in, on a person who had just opened a reset link or a
// sign-in link in a browser that had never seen the app: whatever they were
// typing went with it, and a password-recovery screen, which lived only in
// memory, was replaced by the ordinary app.
//
// So the first claim is not an update. Every later change of controller is.
export function reloadOnWorkerUpdate(
  container: Pick<ServiceWorkerContainer, "controller" | "addEventListener">,
  reload: () => void,
): void {
  let hadController = !!container.controller;
  let reloaded = false;
  container.addEventListener("controllerchange", () => {
    if (!hadController) { hadController = true; return; }
    if (reloaded) return;
    reloaded = true;
    reload();
  });
}
