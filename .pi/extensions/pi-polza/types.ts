/**
 * Types describing the Polza `/api/v1/models/catalog` response.
 *
 * Kept intentionally permissive: the catalog is an external, evolving surface. Unknown
 * fields are allowed via index signatures, and numeric-looking values may arrive as strings
 * (prices are documented as decimal strings).
 */

export interface PolzaPricing {
  prompt_per_million?: string | number | null;
  completion_per_million?: string | number | null;
  input_cache_read_per_million?: string | number | null;
  input_cache_write_per_million?: string | number | null;
  currency?: string | null;
  [key: string]: unknown;
}

export interface PolzaTopProvider {
  name?: string | null;
  icon_provider_slug?: string | null;
  context_length?: number | null;
  max_completion_tokens?: number | null;
  pricing?: PolzaPricing | null;
  supported_parameters?: string[] | null;
  default_parameters?: unknown;
  [key: string]: unknown;
}

export interface PolzaArchitecture {
  modality?: string | null;
  input_modalities?: string[] | null;
  output_modalities?: string[] | null;
  tokenizer?: string | null;
  instruct_type?: string | null;
  [key: string]: unknown;
}

export interface PolzaCatalogModel {
  id: string;
  object?: string;
  owned_by?: string;
  name?: string;
  type?: string;
  short_description?: string;
  architecture?: PolzaArchitecture | null;
  top_provider?: PolzaTopProvider | null;
  endpoints?: string[] | null;
  created?: number;
  [key: string]: unknown;
}

export interface PolzaCatalogMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  availableProviders?: string[];
  [key: string]: unknown;
}

export interface PolzaCatalogPage {
  data: PolzaCatalogModel[];
  meta?: PolzaCatalogMeta;
}
