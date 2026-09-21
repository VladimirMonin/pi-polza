/**
 * pi-subagents bridge: public-RPC capability discovery, timeout, and inert-when-absent behavior.
 *
 * Offline only — the bridge is driven by a fake event bus, so no Pi process and no installed
 * pi-subagents package are required.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSubagentsBridge, type SubagentChildCompletion } from "../.pi/extensions/pi-polza/integrations/subagents.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RPC_READY = "subagents:rpc:v1:ready";
const RPC_REQUEST = "subagents:rpc:v1:request";
const RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";

interface FakePi {
  pi: ExtensionAPI;
  emit(channel: string, data: unknown): void;
  channels(): string[];
}

function createFakePi(): FakePi {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const pi = {
    events: {
      emit(channel: string, data: unknown): void {
        for (const handler of [...(handlers.get(channel) ?? [])]) handler(data);
      },
      on(channel: string, handler: (data: unknown) => void): () => void {
        let set = handlers.get(channel);
        if (!set) {
          set = new Set();
          handlers.set(channel, set);
        }
        set.add(handler);
        return () => set!.delete(handler);
      },
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    emit: (channel, data) => pi.events.emit(channel, data),
    channels: () => [...handlers.keys()],
  };
}

/** Reply to the request the bridge emitted on the request channel. */
function answerPing(fake: FakePi, reply: unknown): string {
  const emitted: Array<{ requestId?: unknown }> = [];
  const original = fake.pi.events.emit;
  (fake.pi.events as { emit: typeof original }).emit = (channel, data) => {
    if (channel === RPC_REQUEST) emitted.push(data as { requestId?: unknown });
    original.call(fake.pi.events, channel, data);
  };
  fake.emit(RPC_READY, { version: 1 });
  const requestId = String(emitted.at(-1)?.requestId);
  (fake.pi.events as { emit: typeof original }).emit = original;
  fake.emit(`${RPC_REPLY_PREFIX}${requestId}`, reply);
  return requestId;
}

const PING_REPLY = {
  capabilities: { asyncSpawn: true },
  events: {
    ready: RPC_READY,
    request: RPC_REQUEST,
    replyPrefix: RPC_REPLY_PREFIX,
    asyncComplete: "subagent:async-complete",
  },
  session: { id: "root-session" },
};

const COMPLETION = {
  runId: "run-1",
  triggerTurn: false,
  intercomDelivered: false,
  results: [
    { agent: "scout", status: "complete", index: 0, sessionPath: "C:/child/run-1/session.jsonl" },
    { agent: "reviewer", status: "complete", index: 1, sessionPath: "C:/child/run-2/session.jsonl" },
  ],
};

test("bridge subscribes to the advertised completion event and forwards children", () => {
  const fake = createFakePi();
  const seen: SubagentChildCompletion[] = [];
  const bridge = createSubagentsBridge(fake.pi, { onChildCompleted: (child) => seen.push(child) });

  assert.equal(bridge.active, false, "inert before discovery");
  answerPing(fake, PING_REPLY);
  assert.equal(bridge.active, true, "active once the completion event is advertised");

  fake.emit("subagent:async-complete", COMPLETION);

  assert.deepEqual(seen, [
    { runId: "run-1", sessionPath: "C:/child/run-1/session.jsonl", agent: "scout", status: "complete", index: 0 },
    { runId: "run-1", sessionPath: "C:/child/run-2/session.jsonl", agent: "reviewer", status: "complete", index: 1 },
  ]);
  bridge.dispose();
});

test("missing ping reply keeps the bridge inert without throwing", async () => {
  const fake = createFakePi();
  const seen: SubagentChildCompletion[] = [];
  const bridge = createSubagentsBridge(fake.pi, { onChildCompleted: (child) => seen.push(child), timeoutMs: 50 });

  fake.emit(RPC_READY, { version: 1 });
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(bridge.active, false);
  fake.emit("subagent:async-complete", COMPLETION);
  assert.deepEqual(seen, [], "no completion subscription without a reply");
  bridge.dispose();
});

test("reply without events.asyncComplete leaves the bridge inert", () => {
  const fake = createFakePi();
  const seen: SubagentChildCompletion[] = [];
  const bridge = createSubagentsBridge(fake.pi, { onChildCompleted: (child) => seen.push(child) });

  answerPing(fake, { capabilities: { asyncSpawn: true }, events: { ready: RPC_READY } });

  assert.equal(bridge.active, false);
  fake.emit("subagent:async-complete", COMPLETION);
  assert.deepEqual(seen, []);
  bridge.dispose();
});

test("payload without results or with non-string sessionPath is ignored", () => {
  const fake = createFakePi();
  const seen: SubagentChildCompletion[] = [];
  const bridge = createSubagentsBridge(fake.pi, { onChildCompleted: (child) => seen.push(child) });
  answerPing(fake, PING_REPLY);

  fake.emit("subagent:async-complete", { runId: "run-1" });
  fake.emit("subagent:async-complete", { runId: "run-1", results: [{ agent: "scout", sessionPath: 42 }] });
  fake.emit("subagent:async-complete", { runId: "run-1", results: "not-an-array" });
  fake.emit("subagent:async-complete", { results: [{ sessionPath: "C:/child/session.jsonl" }] });

  assert.deepEqual(seen, [], "only string sessionPath with a string runId is forwarded");
  bridge.dispose();
});

test("dispose removes every subscription so later events are ignored", () => {
  const fake = createFakePi();
  const seen: SubagentChildCompletion[] = [];
  const bridge = createSubagentsBridge(fake.pi, { onChildCompleted: (child) => seen.push(child) });
  answerPing(fake, PING_REPLY);
  assert.equal(bridge.active, true);

  bridge.dispose();

  assert.equal(bridge.active, false);
  fake.emit("subagent:async-complete", COMPLETION);
  fake.emit(RPC_READY, { version: 1 });
  assert.deepEqual(seen, []);
});

test("unknown payload fields stay forward-compatible", () => {
  const fake = createFakePi();
  const seen: SubagentChildCompletion[] = [];
  const bridge = createSubagentsBridge(fake.pi, { onChildCompleted: (child) => seen.push(child) });
  answerPing(fake, { ...PING_REPLY, futureCapability: { version: 9 } });

  fake.emit("subagent:async-complete", {
    ...COMPLETION,
    nestedChildren: [{ runId: "nested" }],
    futureField: "ignored",
    results: [{ ...COMPLETION.results[0], extra: { deep: true } }],
  });

  assert.deepEqual(seen, [
    { runId: "run-1", sessionPath: "C:/child/run-1/session.jsonl", agent: "scout", status: "complete", index: 0 },
  ]);
  bridge.dispose();
});

test("a throwing consumer does not break the event bus", () => {
  const fake = createFakePi();
  const bridge = createSubagentsBridge(fake.pi, {
    onChildCompleted: () => {
      throw new Error("consumer failure");
    },
  });
  answerPing(fake, PING_REPLY);

  assert.doesNotThrow(() => fake.emit("subagent:async-complete", COMPLETION));
  bridge.dispose();
});
