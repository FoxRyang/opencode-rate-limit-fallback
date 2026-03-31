// Only export the plugin function - OpenCode calls ALL exports as plugins
export { createPlugin as RateLimitFallbackPlugin } from "./src/plugin"

// Type exports are fine (stripped at runtime)
export type {
  RateLimitFallbackConfig,
  FallbackModel,
  FallbackModelObject,
} from "./src/config"

import { createPlugin } from "./src/plugin"
export default createPlugin
