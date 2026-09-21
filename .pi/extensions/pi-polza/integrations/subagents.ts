/**
 * Optional bridge to `pi-subagents` over its public in-process RPC.
 *
 * pi-polza must keep working when pi-subagents is absent, so this module never imports the package
 * and never assumes an event name: it asks the plugin to advertise its own contract (`ping`) and
 * only then subscribes. Nothing here reads child session files — the bridge reports *where* a child
 * wrote its accounting, and the importer decides what to read.
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** pi-subagents RPC channel names; the completion event name is discovered, never hardcoded. */
const RPC_READY_EVENT = "subagents:rpc:v1:ready";
const RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const RPC_REPLY_EVENT_PREFIX = "subagents:rpc:v1:reply:";

const DEFAULT_TIMEOUT_MS = 2500;

/** One child of a completed run that exposed a usable session path. */
export interface SubagentChildCompletion {
  runId: string;
  agent?: string;
  sessionPath?: string;
  status?: string;
  index?: number;
}

export interface SubagentsBridgeOptions {
  onChildCompleted: (child: SubagentChildCompletion) => void;
  timeoutMs?: number;
}

export interface SubagentsBridge {
  readonly active: boolean;
  dispose(): void;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Read the advertised completion event name from a ping reply, tolerating unknown extra fields. */
function advertisedCompletionEvent(reply: unknown): string | undefined {
  if (!isRecord(reply)) return undefined;
  const events = reply.events;
  if (!isRecord(events)) return undefined;
  return nonEmptyString(events.asyncComplete);
}

/** Project the completion payload onto the children that actually name a session file. */
function childrenWithSession(payload: unknown): { runId: string; children: SubagentChildCompletion[] } | undefined {
  if (!isRecord(payload)) return undefined;
  const runId = nonEmptyString(payload.runId);
  if (!runId) return undefined;

  const results = payload.results;
  if (!Array.isArray(results)) return undefined;

  const children: SubagentChildCompletion[] = [];
  for (const entry of results) {
    if (!isRecord(entry)) continue;
    const sessionPath = nonEmptyString(entry.sessionPath);
    if (!sessionPath) continue;

    const child: SubagentChildCompletion = { runId, sessionPath };
    const agent = nonEmptyString(entry.agent);
    if (agent) child.agent = agent;
    const status = nonEmptyString(entry.status);
    if (status) child.status = status;
    if (typeof entry.index === "number" && Number.isFinite(entry.index)) child.index = entry.index;
    children.push(child);
  }

  return { runId, children };
}

/**
 * Discover pi-subagents' async completion event and forward completed children to `onChildCompleted`.
 *
 * The bridge is inert until a `ping` reply advertises a completion event: if the plugin is missing,
 * slow, or renames its contract, pi-polza simply never activates the integration. No exceptions and
 * no user-facing errors escape this module.
 */
export function createSubagentsBridge(pi: ExtensionAPI, options: SubagentsBridgeOptions): SubagentsBridge {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const unsubscribes: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completionEvent: string | undefined;
  let disposed = false;

  const track = (unsubscribe: () => void): void => {
    if (disposed) unsubscribe();
    else unsubscribes.push(unsubscribe);
  };

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const onCompletion = (payload: unknown): void => {
    if (disposed) return;
    const projected = childrenWithSession(payload);
    if (!projected) return;
    for (const child of projected.children) {
      try {
        options.onChildCompleted(child);
      } catch {
        // A consumer failure must not break the event bus for other plugins.
      }
    }
  };

  const onReply = (reply: unknown): void => {
    clearTimer();
    if (disposed) return;
    const event = advertisedCompletionEvent(reply);
    if (!event) return;
    completionEvent = event;
    track(pi.events.on(event, onCompletion));
  };

  const requestDiscovery = (): void => {
    if (disposed) return;
    const requestId = randomUUID();
    track(pi.events.on(`${RPC_REPLY_EVENT_PREFIX}${requestId}`, onReply));
    try {
      pi.events.emit(RPC_REQUEST_EVENT, { version: 1, requestId, method: "ping", params: {} });
    } catch {
      return;
    }
    timer = setTimeout(clearTimer, timeoutMs);
  };

  track(pi.events.on(RPC_READY_EVENT, requestDiscovery));

  return {
    get active() {
      return completionEvent !== undefined && !disposed;
    },
    dispose() {
      disposed = true;
      clearTimer();
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
      completionEvent = undefined;
    },
  };
}
