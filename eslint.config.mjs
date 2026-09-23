import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';
export default defineConfig([...next, ...ts, {files:['scripts/probes/neon-auth.mts'],rules:{'@typescript-eslint/no-explicit-any':'off'}}, globalIgnores(['.next/**','next-env.d.ts'])]);
