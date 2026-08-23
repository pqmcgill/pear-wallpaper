# Spike: headless expo-background-task body starting a Bare Worklet

Throwaway task (deleted) started a Worklet with an inline `BareKit.IPC`
echo source, round-tripped one frame, logged to logcat, terminated.
`triggerTaskWorkerForTestingAsync()` and `adb shell cmd jobscheduler run -f`
are the same call underneath (`BackgroundTaskScheduler.runTasks()`) and
both **no-op while foregrounded** (`inForeground` guard, by design).
Forced while **backgrounded**: worklet started, IPC round-tripped
(`pong:ping`), terminated — works. Forced after `am kill` (bg kill):
process respawns but got frozen mid-boot before RN JS loaded — task never
ran. Force-stopped: job scheduler drops the job immediately, no respawn —
matches documented Android behavior. Bug found+fixed: inline source needs
a non-`.bundle` filename (`.bundle` triggers bare-bundle parsing, crashes);
no global `Buffer` either side, use `b4a`/plain strings.

**Verdict: PASS** (backgrounded case proven) — proceeding to build the real
`background-sync.js`, not the sync-on-open fallback.
