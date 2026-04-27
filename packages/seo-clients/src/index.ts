export {
  DataForSEOClient,
  type KeywordVolume,
  type RelatedKeyword,
  type AmazonKeyword,
} from "./dataforseo.js";

export type { Market as DataForSEOMarket } from "./dataforseo.js";

export {
  amazonAutocomplete,
  googleAutocomplete,
  tmallAutocomplete,
  expandSeed,
  type Market as AutocompleteMarket,
} from "./autocomplete.js";

export {
  embed,
  clusterByCosine,
  type EmbedItem,
  type Cluster,
} from "./embeddings.js";
