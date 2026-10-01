import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Même configuration que Flexfolio
const eslintConfig = defineConfig([
  nextVitals,
  nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "supabase/**"]),
]);

export default eslintConfig;
