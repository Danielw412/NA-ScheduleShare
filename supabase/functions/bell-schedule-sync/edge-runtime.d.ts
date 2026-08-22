declare module '@supabase/functions-js/edge-runtime.d.ts'

declare const Deno: {
  env: {
    get(name: string): string | undefined
  }
}
