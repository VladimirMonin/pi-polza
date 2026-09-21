/**
 * Polza model catalog: full-pagination fetch and conservative capability inspection.
 *
 * Pure data layer — no Pi types, no provider registration. Used by the diagnostic probe
 * and by the Pi provider's refreshModels().
 */
import { polzaJson } from "./http.ts";
import type { PolzaCatalogModel, PolzaCatalogPage } from "./types.ts";

/** Polza chat completions endpoint advertised by catalog entries. */
export const CHAT_COMPLETIONS_ENDPOINT = "/api/v1/chat/completions";

export interface FetchCatalogOptions {
  /** Page size. Polza caps this; 100 has been sufficient in practice. */
  limit?: number;
  /** Safety valve against an unbounded loop if `meta.totalPages` is ever wrong. */
  maxPages?: number;
  signal?: AbortSignal;
  /** Called after each page for progress reporting. */
  onPage?: (page: PolzaCatalogPage, pageNumber: number) => void;
}

export interface CatalogResult {
  models: PolzaCatalogModel[];
  /** Number of HTTP pages actually fetched. */
  pages: number;
  /** `meta.total` reported by Polza, when present. */
  reportedTotal: number | null;
}

/**
 * Fetch the entire catalog, following pagination until `totalPages` is exhausted.
 * Never assume the first page is the whole catalog.
 */
export async function fetchCatalog(options: FetchCatalogOptions = {}): Promise<CatalogResult> {
  const limit = options.limit ?? 100;
  const maxPages = options.maxPages ?? 1000;
  const models: PolzaCatalogModel[] = [];
  let reportedTotal: number | null = null;
  let totalPages = Number.POSITIVE_INFINITY;
  let pageNumber = 1;
  let pages = 0;

  while (pageNumber <= totalPages && pages < maxPages) {
    const payload = await polzaJson<PolzaCatalogPage>(
      `/models/catalog?page=${pageNumber}&limit=${limit}`,
      { signal: options.signal },
    );
    const data = Array.isArray(payload.data) ? payload.data : [];
    models.push(...data);
    pages += 1;
    options.onPage?.(payload, pageNumber);

    const meta = payload.meta;
    if (meta && typeof meta.total === "number") reportedTotal = meta.total;
    if (meta && typeof meta.totalPages === "number" && meta.totalPages > 0) {
      totalPages = meta.totalPages;
    } else if (data.length < limit) {
      break;
    }

    if (data.length === 0) break;
    pageNumber += 1;
  }

  return { models, pages, reportedTotal };
}

/** `type === "chat"`. */
export function isChatModel(model: PolzaCatalogModel): boolean {
  return model.type === "chat";
}

/** Whether the model advertises the OpenAI-compatible chat completions endpoint. */
export function supportsChatCompletions(model: PolzaCatalogModel): boolean {
  return Array.isArray(model.endpoints) && model.endpoints.includes(CHAT_COMPLETIONS_ENDPOINT);
}

/**
 * Whether the model produces text output. The catalog labels some embedding models as
 * `type: "chat"` (e.g. baai/bge-*) with `output_modalities: ["embeddings"]`, so filtering on
 * `type` alone would register non-chat models in Pi.
 */
export function supportsTextOutput(model: PolzaCatalogModel): boolean {
  const outputs = model.architecture?.output_modalities;
  if (!Array.isArray(outputs) || outputs.length === 0) return true; // unknown → do not exclude here
  return outputs.includes("text");
}

/** A chat model that can actually serve OpenAI-compatible chat completions with text output. */
export function isUsableChatModel(model: PolzaCatalogModel): boolean {
  return isChatModel(model) && supportsChatCompletions(model) && supportsTextOutput(model);
}

function supportedParameters(model: PolzaCatalogModel): string[] {
  const params = model.top_provider?.supported_parameters;
  return Array.isArray(params) ? params : [];
}

export function hasParameter(model: PolzaCatalogModel, parameter: string): boolean {
  return supportedParameters(model).includes(parameter);
}

/** Tool calling support (`tools` or `tool_choice`). */
export function supportsTools(model: PolzaCatalogModel): boolean {
  return hasParameter(model, "tools") || hasParameter(model, "tool_choice");
}

/** Vision input (`image` in `architecture.input_modalities`). */
export function supportsVision(model: PolzaCatalogModel): boolean {
  const modalities = model.architecture?.input_modalities;
  return Array.isArray(modalities) && modalities.includes("image");
}

/** Reasoning support from any of the documented metadata flags. */
export function supportsReasoning(model: PolzaCatalogModel): boolean {
  return (
    hasParameter(model, "reasoning") ||
    hasParameter(model, "reasoning_effort") ||
    hasParameter(model, "include_reasoning")
  );
}

/** Whether the catalog publishes cache read/write pricing for this model. */
export function hasCachePricing(model: PolzaCatalogModel): boolean {
  const pricing = model.top_provider?.pricing;
  if (!pricing) return false;
  return (
    toNumber(pricing.input_cache_read_per_million) !== undefined ||
    toNumber(pricing.input_cache_write_per_million) !== undefined
  );
}

/** Parse a price that Polza may deliver as a decimal string or a number. */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
