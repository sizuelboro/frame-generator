/* =========================================================================
   FrameForge — platform limits for the Canva app
   =========================================================================
   MIRROR of /shared/frameforge-limits.js. That file is the single source of
   truth; this file exists only because the Canva app build is TypeScript and
   must not reach outside src/.

   `npm run check:limits` fails the build if these numbers drift apart.
   Never edit one side alone.
   ========================================================================= */

/** Safe UTF-8 byte budget for path data. Applies to every mode. */
export const PATH_BUDGET = 1980;

/** Hard Canva ceiling, diagnostics only. Never validate against this. */
export const CANVA_HARD_PATH_LIMIT = 2048;

/** Max opening paths in a single combined-budget frame. */
export const MAX_PATHS_SINGLE = 29;

/** Max separate aligned elements in an "exact multi" silhouette. */
export const MAX_PATHS_MULTI = 12;

/** Max pixel dimension accepted for any asset. */
export const MAX_DIMENSION = 16384;

/** Max decoded bytes for a published overlay/thumb/mask image. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Max decoded bytes for a user photo loaded for Smart Mask. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** Absolute value ceiling for any single path coordinate. */
export const MAX_COORDINATE = 1e7;

export type BudgetShape = {
  mode?: "overlay" | "silhouette" | "smart-mask";
  multiElement?: boolean;
  paths: string[];
  w?: number;
  h?: number;
};

export function isExactMulti(frame: BudgetShape): boolean {
  if (!frame || frame.mode !== "silhouette") return false;
  if (frame.multiElement === true) return true;
  return Array.isArray(frame.paths) && frame.paths.length > 1;
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(String(value ?? "")).length;
}

export type BudgetResult = {
  ok: boolean;
  mode: "multi" | "single";
  budget: number;
  used: number;
  worstIndex: number;
  reason: string;
};

/** The single budget rule, shared by the Worker, the Studio and this app. */
export function measurePathBudget(frame: BudgetShape): BudgetResult {
  const paths = Array.isArray(frame?.paths) ? frame.paths.map(String) : [];

  if (isExactMulti(frame)) {
    const sizes = paths.map(utf8Bytes);
    let worstIndex = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[worstIndex]) worstIndex = i;
    const used = sizes.length ? sizes[worstIndex] : 0;
    return {
      ok: used <= PATH_BUDGET,
      mode: "multi",
      budget: PATH_BUDGET,
      used,
      worstIndex,
      reason: used <= PATH_BUDGET
        ? ""
        : `Object ${worstIndex + 1} is ${used} bytes; the safe native budget is ${PATH_BUDGET} bytes per object.`,
    };
  }

  const overlayPath = frame?.mode === "silhouette"
    ? ""
    : `M 0 0 H ${Number(frame?.w) || 0} V ${Number(frame?.h) || 0} H 0 Z`;
  const used = utf8Bytes([overlayPath, ...paths].join(""));
  return {
    ok: used <= PATH_BUDGET,
    mode: "single",
    budget: PATH_BUDGET,
    used,
    worstIndex: -1,
    reason: used <= PATH_BUDGET
      ? ""
      : `Combined path data is ${used} bytes; the safe native budget is ${PATH_BUDGET} bytes.`,
  };
}

export function maxPathsFor(frame: BudgetShape): number {
  return isExactMulti(frame) ? MAX_PATHS_MULTI : MAX_PATHS_SINGLE;
}
