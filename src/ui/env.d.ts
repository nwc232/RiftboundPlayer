/**
 * The two build-time values the front-end reads.
 *
 * Declared here rather than by referencing `vite/client`, which would pull
 * Vite's whole set of ambient globals into a project whose engine is
 * deliberately free of build-tool assumptions. Interface merging adds these to
 * the `ImportMeta` the compiler already knows about.
 */
interface ImportMetaEnv {
  /** Where the app is served from — `/` locally, `/<repo>/` on Pages. */
  readonly BASE_URL: string;
  /** "1" on a build with no server behind it, so it can say so. */
  readonly VITE_NO_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
