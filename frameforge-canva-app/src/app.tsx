import { useFeatureSupport, useSelection } from "@canva/app-hooks";
import { upload } from "@canva/asset";
import { addElementAtPoint } from "@canva/design";
import { useEffect, useState } from "react";
import bundledMockups from "./mockups.json";
import {
  MAX_COORDINATE,
  MAX_DIMENSION,
  MAX_PHOTO_BYTES,
  PATH_BUDGET,
  isExactMulti,
  maxPathsFor,
  measurePathBudget,
} from "./limits";

type Mockup = {
  id: string;
  name: string;
  w: number;
  h: number;
  assetWidth?: number;
  assetHeight?: number;
  mode?: "overlay" | "silhouette" | "smart-mask";
  smartMask?: boolean;
  maskUrl?: string | null;
  multiElement?: boolean;
  /**
   * Openings that are fully enclosed holes the Studio could not bridge into
   * the outer contour. Canva paths allow exactly one M, so an enclosed hole
   * cannot be expressed natively. A non-zero value means this frame will
   * insert with those holes filled in.
   */
  unbridgedHoles?: number;
  overlayUrl?: string | null;
  thumbUrl?: string;
  mimeType?: "image/png" | "image/jpeg";
  aiDisclosure?: "none" | "app_generated";
  paths: string[];
  folderId?: string;
};

type Folder = { id: string; name: string; createdAt?: string };

const fallbackMockups = bundledMockups as Mockup[];
const URL_KEY = "frameforge.workerUrl";
const TOKEN_KEY = "frameforge.adminToken";

function cleanBase(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function isAllowedWorkerUrl(value: string) {
  return /^https:\/\//i.test(value) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(value);
}

function validateCanvaPath(path: string): string | null {
  const commands = path.match(/[A-DF-Za-df-z]/g) || [];
  if (!/^\s*[Mm](?:\s|[-+0-9.])/.test(path)) return "Every path must start with M.";
  if (commands.filter((command) => command.toLowerCase() === "m").length !== 1) return "Every path must contain exactly one M.";
  if (commands.some((command) => !"mlhvcsaz".includes(command.toLowerCase()))) return "A path contains an unsupported Canva command.";
  if (!/[Zz]\s*$/.test(path)) return "Every path must be closed with Z.";
  const numbers = path.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  if (!numbers.length || numbers.some((number) => !Number.isFinite(Number(number)) || Math.abs(Number(number)) > MAX_COORDINATE)) return "A path contains an invalid coordinate.";
  return null;
}

function readFileDataUrl(file: File): Promise<string> { return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result)); r.onerror=()=>reject(r.error); r.readAsDataURL(file); }); }
function loadBrowserImage(src: string): Promise<HTMLImageElement> { return new Promise((resolve,reject)=>{ const im=new Image(); im.crossOrigin="anonymous"; im.onload=()=>resolve(im); im.onerror=()=>reject(new Error("Could not load image or mask")); im.src=src; }); }
async function composeSmartMask(mockup: Mockup, file: File, zoom: number, panX: number, panY: number, rotation: number): Promise<string> {
  if(!mockup.maskUrl) throw new Error("Smart Mask URL is missing");
  // Validate before decoding. These checks used to run after the file had
  // already been read and decoded, so an oversized photo was fully loaded
  // into memory before being rejected.
  if (!file.type.startsWith("image/")) throw new Error("Choose a valid image file");
  if (file.size > MAX_PHOTO_BYTES) throw new Error(`Photo is larger than ${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))} MB`);
  const w=Math.max(2,Math.round(mockup.assetWidth||mockup.w)),h=Math.max(2,Math.round(mockup.assetHeight||mockup.h));
  if (![w,h].every((value)=>Number.isFinite(value)&&value<=MAX_DIMENSION)) throw new Error("Smart Mask dimensions are too large");
  const [photo,mask]=await Promise.all([loadBrowserImage(await readFileDataUrl(file)),loadBrowserImage(mockup.maskUrl)]);
  const c=document.createElement("canvas"); c.width=w;c.height=h; const x=c.getContext("2d")!;
  const scale=Math.max(w/photo.naturalWidth,h/photo.naturalHeight)*zoom,dw=photo.naturalWidth*scale,dh=photo.naturalHeight*scale;
  x.save();x.translate(w/2+(panX/100)*w,h/2+(panY/100)*h);x.rotate(rotation*Math.PI/180);x.drawImage(photo,-dw/2,-dh/2,dw,dh);x.restore();
  x.globalCompositeOperation="destination-in"; x.drawImage(mask,0,0,w,h); x.globalCompositeOperation="source-over"; return c.toDataURL("image/png");
}

function validateMockup(mockup: Mockup): string | null {
  if (!mockup.id || !mockup.name) return "Mockup id/name is missing.";
  if (![mockup.w, mockup.h, mockup.assetWidth ?? mockup.w, mockup.assetHeight ?? mockup.h].every((value) => Number.isFinite(value) && value > 0 && value <= MAX_DIMENSION)) return `Mockup dimensions must be finite and no larger than ${MAX_DIMENSION}px.`;
  if (mockup.mode === "smart-mask") { if (!/^https:\/\//i.test(mockup.maskUrl || "")) return "Smart Mask URL must be public HTTPS."; return null; }
  if (!/^https:\/\//i.test(mockup.overlayUrl || "")) return "Overlay URL must be public HTTPS.";

  const maxPaths = maxPathsFor(mockup);
  if (!mockup.paths.length || mockup.paths.length > maxPaths) {
    return isExactMulti(mockup)
      ? `Exact multi supports 1–${maxPaths} objects.`
      : `A frame needs 1–${maxPaths} opening paths.`;
  }

  // One budget rule for every layer. Validating against Canva's raw 2048
  // ceiling here used to accept frames the Worker rejected at 1980.
  const budget = measurePathBudget(mockup);
  if (!budget.ok) return budget.reason;

  for (const path of mockup.paths) { const error = validateCanvaPath(path); if (error) return error; }
  return null;
}

/**
 * Canva shape paths allow exactly one M, so an enclosed hole cannot be
 * subtracted from its own contour. The Studio bridges what it can; whatever
 * is left is reported here so the insert never looks silently wrong.
 */
function holeSuffix(mockup: Mockup): string {
  const holes = mockup.unbridgedHoles ?? 0;
  if (holes <= 0) return "";
  return ` ${holes} enclosed hole${holes > 1 ? "s" : ""} could not be cut natively and inserted filled; republish as Smart Mask for an exact cut-out.`;
}

const inlineStyles = `
[data-frameforge-app] { display:grid; gap:14px; width:100%; min-width:0; padding:16px; overflow:hidden; box-sizing:border-box; color:#2c2c2b; font-family:Arial,sans-serif; }
[data-frameforge-app] * { box-sizing:border-box; }
[data-frameforge-app] .hero { display:grid; gap:5px; min-width:0; }
[data-frameforge-app] .hero h1 { margin:0; font-size:22px; line-height:1.15; }
[data-frameforge-app] .hero p { margin:0; font-size:13px; line-height:1.4; }
[data-frameforge-app] .eyebrow { color:#2783de; font-size:11px; font-weight:700; letter-spacing:.12em; }
[data-frameforge-app] .libraryControls { display:grid; gap:8px; min-width:0; padding:11px; border:1px solid #d8e9f8; border-radius:10px; background:#f2f8fd; }
[data-frameforge-app] .libraryControls label { font-size:12px; font-weight:700; }
[data-frameforge-app] input { display:block; width:100%; min-width:0; padding:8px 9px; border:1px solid #b7c9d9; border-radius:7px; background:#fff; font:inherit; }
[data-frameforge-app] button { min-height:34px; padding:7px 11px; border:1px solid #8b3dff; border-radius:7px; background:#8b3dff; color:#fff; font:600 13px Arial,sans-serif; cursor:pointer; }
[data-frameforge-app] button:disabled { cursor:not-allowed; opacity:.55; }
[data-frameforge-app] .libraryControls label span { color:#777; font-size:11px; font-weight:400; }
[data-frameforge-app] .settingsActions { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; }
[data-frameforge-app] .clearTokenButton { border-color:#d9d7d3; background:#fff; color:#444; }
[data-frameforge-app] .securityNote { margin:0; color:#6f6d69; font-size:11px; line-height:1.4; }
[data-frameforge-app] .cardActions { display:grid; gap:5px; width:68px; }
[data-frameforge-app] .cardActions button { width:100%; min-height:30px; padding:5px 7px; }
[data-frameforge-app] .deleteButton { border-color:#c93737; background:#fff; color:#a82424; }
[data-frameforge-app] .deleteButton:hover { background:#fdecec; }
[data-frameforge-app] .confirmDeleteButton { border-color:#b42323; background:#c93737; color:#fff; }
[data-frameforge-app] .cancelDeleteButton { border-color:#aaa; background:#fff; color:#444; }
[data-frameforge-app] .list { display:grid; gap:10px; min-width:0; }
[data-frameforge-app] .card { display:grid; grid-template-columns:58px minmax(0,1fr) auto; align-items:center; gap:10px; width:100%; min-width:0; padding:9px; border:1px solid #e6e5e3; border-radius:10px; background:#f9f8f7; }
[data-frameforge-app] .preview { display:grid; place-items:center; width:58px; height:58px; overflow:hidden; border:1px solid #e6e5e3; border-radius:7px; background:#fff; }
[data-frameforge-app] .preview img { display:block; width:100%; height:100%; max-width:100%; object-fit:contain; }
[data-frameforge-app] .details { min-width:0; overflow:hidden; }
[data-frameforge-app] .name { overflow:hidden; font-size:14px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
[data-frameforge-app] .meta { margin-top:3px; color:#777; font-size:12px; }
[data-frameforge-app] .alert { padding:10px; border-radius:8px; font-size:13px; line-height:1.35; overflow-wrap:anywhere; }
[data-frameforge-app] .alert.positive { background:#e7f7ee; color:#155b35; }
[data-frameforge-app] .alert.critical { background:#fdecec; color:#842020; }
[data-frameforge-app] .tip { padding:10px; border-left:3px solid #d5803b; border-radius:4px 8px 8px 4px; background:#fbebde; color:#5c4938; font-size:12px; line-height:1.4; }
[data-frameforge-app] .smartControls { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:11px; border:1px solid #d9c7f8; border-radius:10px; background:#f7f2ff; }
[data-frameforge-app] .smartControls h2, [data-frameforge-app] .smartControls p { grid-column:1/-1; margin:0; }
[data-frameforge-app] .smartControls label { display:grid; gap:3px; font-size:11px; font-weight:700; }
[data-frameforge-app] .photoPick { margin-top:7px; font-size:11px; }
[data-frameforge-app] .folderPanel { display:grid; gap:7px; padding:10px; border:1px solid #e6e5e3; border-radius:10px; background:#fff; }
[data-frameforge-app] .folderToolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; }
[data-frameforge-app] .folderToolbar div { display:grid; gap:2px; }
[data-frameforge-app] .folderToolbar span { color:#7d7a75; font-size:11px; }
[data-frameforge-app] .folderToolbar button { min-height:30px; padding:5px 8px; }
[data-frameforge-app] .searchInput { min-height:36px; }
[data-frameforge-app] .folderGroup { display:grid; grid-template-columns:minmax(0,1fr) 32px 32px; gap:5px; }
[data-frameforge-app] .folderRow { display:grid; grid-template-columns:20px minmax(0,1fr) auto; align-items:center; gap:7px; width:100%; min-height:36px; padding:6px 8px; border-color:transparent; background:#fff; color:#2c2c2b; text-align:left; }
[data-frameforge-app] .folderRow:hover { background:#f0efed; }
[data-frameforge-app] .folderRow.active { border-color:#d9c7f8; background:#f4ecff; color:#5f1abd; }
[data-frameforge-app] .folderRow b { color:#7d7a75; font-size:11px; }
[data-frameforge-app] .folderIcon { color:#7d7a75; }
[data-frameforge-app] .iconButton { min-height:32px; padding:4px; border-color:#e6e5e3; background:#fff; color:#555; }
[data-frameforge-app] .iconButton.danger { color:#a82424; }
[data-frameforge-app] .moveSelect { width:100%; margin-top:7px; padding:5px 7px; border:1px solid #d9d7d3; border-radius:6px; background:#fff; font:11px Arial,sans-serif; }
[data-frameforge-app] .holeWarning { margin-top:5px; padding:5px 7px; border-radius:6px; background:#fbebde; color:#7a4a1d; font-size:11px; line-height:1.35; }
[data-frameforge-app] .emptyState { padding:22px 12px; border:1px dashed #d9d7d3; border-radius:10px; color:#7d7a75; font-size:13px; text-align:center; }
[data-frameforge-app] { gap:12px; padding:14px 12px 20px; color:#0d1216; font-family:Arial,sans-serif; background:#fff; }
[data-frameforge-app] .nativeHeader { display:flex; align-items:center; justify-content:space-between; gap:10px; }
[data-frameforge-app] .nativeHeader h1 { margin:2px 0 0; font-size:20px; line-height:1.15; }
[data-frameforge-app] .headerActions { display:flex; gap:4px; }
[data-frameforge-app] .ghostButton { min-height:36px; padding:6px 9px; border-color:transparent; background:transparent; color:#2c2c2b; }
[data-frameforge-app] .ghostButton:hover { background:#f0efed; }
[data-frameforge-app] .searchWrap { display:grid; grid-template-columns:22px minmax(0,1fr); align-items:center; gap:5px; min-height:44px; padding:0 10px; border:1px solid #d9d7d3; border-radius:10px; background:#fff; }
[data-frameforge-app] .searchWrap:focus-within { border-color:#8b3dff; box-shadow:0 0 0 2px rgba(139,61,255,.14); }
[data-frameforge-app] .nativeSearch { padding:8px 0; border:0; outline:0; }
[data-frameforge-app] .libraryControls { border-color:#e6e5e3; background:#f9f8f7; }
[data-frameforge-app] .folderPanel { gap:4px; padding:0; border:0; }
[data-frameforge-app] .folderToolbar { min-height:40px; }
[data-frameforge-app] .newFolderButton { min-height:36px; border-color:transparent; background:transparent; color:#5f1abd; }
[data-frameforge-app] .newFolderButton:hover { background:#f4ecff; }
[data-frameforge-app] .folderRow { min-height:42px; border-radius:8px; font-size:14px; }
[data-frameforge-app] .folderRow.active { border-color:transparent; background:#f4ecff; color:#5f1abd; }
[data-frameforge-app] .folderGroup { grid-template-columns:minmax(0,1fr) 36px 36px; align-items:center; }
[data-frameforge-app] .iconButton { min-height:36px; border-color:transparent; border-radius:8px; }
[data-frameforge-app] .card { padding:8px; border-color:#ededeb; border-radius:10px; background:#fff; }
[data-frameforge-app] .moveSelect { min-height:30px; }
[data-frameforge-app] .dialogBackdrop { position:fixed; inset:0; z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(17,18,20,.46); }
[data-frameforge-app] .nativeDialog { display:grid; gap:14px; width:min(320px,100%); padding:18px; border-radius:12px; background:#fff; box-shadow:0 12px 40px rgba(0,0,0,.24); }
[data-frameforge-app] .nativeDialog h2 { margin:0; font-size:20px; }
[data-frameforge-app] .nativeDialog p { margin:0; color:#5c5a57; font-size:13px; line-height:1.45; }
[data-frameforge-app] .nativeDialog label { display:grid; gap:6px; font-size:12px; font-weight:700; }
[data-frameforge-app] .dialogActions { display:flex; justify-content:flex-end; gap:8px; }
[data-frameforge-app] .secondaryButton { border-color:#d9d7d3; background:#fff; color:#2c2c2b; }
[data-frameforge-app] .dangerButton { border-color:#c93737; background:#c93737; }
@media (max-width:340px) { [data-frameforge-app] .card { grid-template-columns:52px minmax(0,1fr); } [data-frameforge-app] .preview { width:52px; height:52px; } [data-frameforge-app] .card button { grid-column:1/-1; width:100%; } }
`;

export function App() {
  const isSupported = useFeatureSupport();
  const canInsert = isSupported(addElementAtPoint);
  const [mockups, setMockups] = useState<Mockup[]>(fallbackMockups);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [folderDialog, setFolderDialog] = useState<{ mode: "create" | "rename" | "delete"; folder?: Folder } | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [workerUrl, setWorkerUrl] = useState(() => localStorage.getItem(URL_KEY) || "");
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const [busy, setBusy] = useState<string | null>(null);
  const [smartFiles, setSmartFiles] = useState<Record<string, File | null>>({});
  const imageSelection = useSelection("image");
  const [smartZoom, setSmartZoom] = useState(1);
  const [smartPanX, setSmartPanX] = useState(0);
  const [smartPanY, setSmartPanY] = useState(0);
  const [smartRotation, setSmartRotation] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "positive" | "critical"; text: string } | null>(null);

  async function refreshLibrary(showNotice = true) {
    const base = cleanBase(workerUrl);
    if (!base || !isAllowedWorkerUrl(base)) {
      if (showNotice) setNotice({ tone: "critical", text: "Enter a valid HTTPS Worker URL (localhost HTTP is allowed for development)." });
      return;
    }
    setRefreshing(true);
    try {
      const response = await fetch(`${base}/api/frames`, { cache: "no-store" });
      const data = (await response.json()) as { frames?: Mockup[]; folders?: Folder[]; folderSystem?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const frames = Array.isArray(data.frames) ? data.frames : [];
      setMockups(frames);
      setFolders(Array.isArray(data.folders) ? data.folders : []);
      if (data.folderSystem !== true && showNotice) setNotice({ tone: "critical", text: "Worker v7.0 is required for folder management." });
      localStorage.setItem(URL_KEY, base);
      if (showNotice) setNotice({ tone: "positive", text: `Library refreshed: ${frames.length} cloud frame(s).` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice({ tone: "critical", text: `Library refresh failed: ${message}` });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (workerUrl) void refreshLibrary(false);
    // Load once from the saved URL. Manual Refresh handles later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteMockup(mockup: Mockup) {
    const base = cleanBase(workerUrl);
    const token = adminToken.trim();
    if (!base || !isAllowedWorkerUrl(base)) {
      setNotice({ tone: "critical", text: "Enter a valid HTTPS Worker URL first." });
      return;
    }
    if (!token) {
      setNotice({ tone: "critical", text: "Enter the admin token to delete a frame." });
      return;
    }
    setBusy(`delete:${mockup.id}`);
    setNotice(null);
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      const response = await fetch(`${base}/api/frames/${encodeURIComponent(mockup.id)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setMockups((current) => current.filter((item) => item.id !== mockup.id));
      setConfirmDeleteId(null);
      setNotice({ tone: "positive", text: `${mockup.name} deleted from Worker and R2.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice({ tone: "critical", text: `Delete failed: ${message}` });
    } finally {
      setBusy(null);
    }
  }

  function adminConfig() {
    const base = cleanBase(workerUrl), token = adminToken.trim();
    if (!base || !isAllowedWorkerUrl(base)) { setNotice({ tone: "critical", text: "Enter a valid HTTPS Worker URL first." }); return null; }
    if (!token) { setNotice({ tone: "critical", text: "Enter the admin token for folder management." }); return null; }
    sessionStorage.setItem(TOKEN_KEY, token); return { base, token };
  }

  async function createFolder(name: string) {
    const config = adminConfig(); if (!config || !name.trim()) return;
    setBusy("folder:create");
    try {
      const response = await fetch(`${config.base}/api/folders`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` }, body: JSON.stringify({ name: name.trim() }) });
      const data = (await response.json()) as { folder?: Folder; folders?: Folder[]; error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const created = data.folder;
      if (!created?.id) throw new Error("Worker did not return the created folder. Deploy Worker v7.0 or newer.");
      setFolders((current) => {
        const source = Array.isArray(data.folders) ? data.folders : current;
        return [...source.filter((item) => item.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name));
      });
      setCurrentFolderId(created.id); setSearch(""); setFolderDialog(null); setFolderDraft("");
      const verifyResponse = await fetch(`${config.base}/api/frames`, { cache: "no-store" });
      const verify = (await verifyResponse.json()) as { folders?: Folder[]; error?: string };
      if (!verifyResponse.ok) throw new Error(verify.error || `Verification HTTP ${verifyResponse.status}`);
      const verifiedFolders = Array.isArray(verify.folders) ? verify.folders : [];
      if (!verifiedFolders.some((item) => item.id === created.id)) throw new Error("Folder was not found after creation. Redeploy Worker v7.0 and try again.");
      setFolders(verifiedFolders); setNotice({ tone: "positive", text: `Folder “${created.name}” created and verified.` });
    }
    catch (error) { setNotice({ tone: "critical", text: `Create folder failed: ${error instanceof Error ? error.message : String(error)}` }); } finally { setBusy(null); }
  }

  async function renameFolder(folder: Folder, name: string) {
    const config = adminConfig(); if (!config || !name.trim() || name.trim() === folder.name) return;
    setBusy(`folder:${folder.id}`);
    try { const response = await fetch(`${config.base}/api/folders/${encodeURIComponent(folder.id)}`, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` }, body: JSON.stringify({ name: name.trim() }) }); const data = (await response.json()) as { folders?: Folder[]; error?: string }; if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); setFolders(data.folders || folders.map((item) => item.id === folder.id ? { ...item, name: name.trim() } : item)); setNotice({ tone: "positive", text: "Folder renamed." }); setFolderDialog(null); setFolderDraft(""); }
    catch (error) { setNotice({ tone: "critical", text: `Rename failed: ${error instanceof Error ? error.message : String(error)}` }); } finally { setBusy(null); }
  }

  async function deleteFolder(folder: Folder) {
    const config = adminConfig(); if (!config) return;
    setBusy(`folder:${folder.id}`);
    try { const response = await fetch(`${config.base}/api/folders/${encodeURIComponent(folder.id)}`, { method: "DELETE", headers: { authorization: `Bearer ${config.token}` } }); const data = (await response.json()) as { movedToUncategorized?: number; error?: string }; if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); setFolders((current) => current.filter((item) => item.id !== folder.id)); setMockups((current) => current.map((item) => item.folderId === folder.id ? { ...item, folderId: "" } : item)); if (currentFolderId === folder.id) setCurrentFolderId(""); setNotice({ tone: "positive", text: `Folder deleted; ${data.movedToUncategorized || 0} frame(s) moved to Uncategorized.` }); setFolderDialog(null); }
    catch (error) { setNotice({ tone: "critical", text: `Delete folder failed: ${error instanceof Error ? error.message : String(error)}` }); } finally { setBusy(null); }
  }

  async function moveMockup(mockup: Mockup, folderId: string) {
    const config = adminConfig(); if (!config) return;
    setBusy(`move:${mockup.id}`);
    try { const response = await fetch(`${config.base}/api/frames/${encodeURIComponent(mockup.id)}`, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` }, body: JSON.stringify({ folderId }) }); const data = (await response.json()) as { frame?: Mockup; error?: string }; if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); setMockups((current) => current.map((item) => item.id === mockup.id ? { ...item, folderId } : item)); setNotice({ tone: "positive", text: `${mockup.name} moved to ${folders.find((folder) => folder.id === folderId)?.name || "Uncategorized"}.` }); }
    catch (error) { setNotice({ tone: "critical", text: `Move failed: ${error instanceof Error ? error.message : String(error)}` }); } finally { setBusy(null); }
  }

  async function insert(mockup: Mockup) {
    const validationError = validateMockup(mockup);
    if (validationError) {
      setNotice({ tone: "critical", text: validationError });
      return;
    }

    setBusy(mockup.id);
    setNotice(null);
    try {
      if (mockup.mode === "smart-mask") { const file=smartFiles[mockup.id]; if(!file) throw new Error("Choose a photo first"); const dataUrl=await composeSmartMask(mockup,file,smartZoom,smartPanX,smartPanY,smartRotation); const draft=imageSelection.count?await imageSelection.read():null; const parentRef=draft?.contents[0]?.ref; const asset=await upload({type:"image",mimeType:"image/png",url:dataUrl,thumbnailUrl:dataUrl,width:mockup.assetWidth||mockup.w,height:mockup.assetHeight||mockup.h,aiDisclosure:"none",...(parentRef?{parentRef}:{})}); if(draft){draft.contents.forEach(content=>content.ref=asset.ref);await draft.save()}else await addElementAtPoint({type:"image",ref:asset.ref,width:mockup.w,height:mockup.h,altText:{text:mockup.name,decorative:false}}); await asset.whenUploaded(); setNotice({tone:"positive",text:`${mockup.name} ${draft?'updated':'added'} as an exact transparent Smart Mask image.`}); return; }
      const isSilhouette = mockup.mode === "silhouette";
      let shapePaths: any[];
      if (isSilhouette) {
        // A single SVG silhouette remains the proven one-element workflow.
        // Exact raster multi silhouettes are inserted as aligned, full-viewBox
        // elements so every object gets its own 2048-byte path budget while
        // sharing the same starter photo asset.
        const starter = await upload({ type: "image", mimeType: mockup.mimeType ?? "image/png", url: mockup.thumbUrl!, thumbnailUrl: mockup.thumbUrl!, width: mockup.assetWidth ?? mockup.w, height: mockup.assetHeight ?? mockup.h, aiDisclosure: mockup.aiDisclosure ?? "none" });
        const exactMulti = mockup.multiElement === true || mockup.paths.length > 1;
        if (exactMulti) {
          if (mockup.overlayUrl) {
            const details = await upload({ type: "image", mimeType: mockup.mimeType ?? "image/png", url: mockup.overlayUrl, thumbnailUrl: mockup.overlayUrl, width: mockup.assetWidth ?? mockup.w, height: mockup.assetHeight ?? mockup.h, aiDisclosure: mockup.aiDisclosure ?? "none" });
            await addElementAtPoint({ type: "shape", paths: [{ d: `M 0 0 H ${mockup.w} V ${mockup.h} H 0 Z`, fill: { dropTarget: false, asset: { type: "image", ref: details.ref } } }], viewBox: { top: 0, left: 0, width: mockup.w, height: mockup.h } });
          }
          for (const d of mockup.paths) {
            await addElementAtPoint({ type: "shape", paths: [{ d, fill: { dropTarget: true, asset: { type: "image", ref: starter.ref } } }], viewBox: { top: 0, left: 0, width: mockup.w, height: mockup.h } });
          }
          setNotice({ tone: "positive", text: `${mockup.name} added as ${mockup.paths.length} aligned native Canva frames using one starter photo.${holeSuffix(mockup)}` });
          return;
        }
        shapePaths = mockup.paths.map((d) => ({ d, fill: { dropTarget: true, asset: { type: "image", ref: starter.ref } } }));
      } else {
        // Preserve the proven opening/mockup workflow unchanged.
        shapePaths = mockup.paths.map((d) => ({ d, fill: { dropTarget: true } }));
        const overlay = await upload({ type: "image", mimeType: mockup.mimeType ?? "image/png", url: mockup.overlayUrl!, thumbnailUrl: mockup.thumbUrl || mockup.overlayUrl!, width: mockup.assetWidth ?? mockup.w, height: mockup.assetHeight ?? mockup.h, aiDisclosure: mockup.aiDisclosure ?? "none" });
        shapePaths.push({ d: `M 0 0 H ${mockup.w} V ${mockup.h} H 0 Z`, fill: { dropTarget: false, asset: { type: "image", ref: overlay.ref } } });
      }
      await addElementAtPoint({ type: "shape", paths: shapePaths, viewBox: { top: 0, left: 0, width: mockup.w, height: mockup.h } });

      setNotice({ tone: "positive", text: `${mockup.name} added as one native Canva frame.${holeSuffix(mockup)}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice({ tone: "critical", text: `Could not add mockup: ${message}` });
    } finally {
      setBusy(null);
    }
  }

  const query = search.trim().toLowerCase();
  const visibleMockups = mockups.filter((item) => (currentFolderId === null || String(item.folderId || "") === currentFolderId) && (!query || item.name.toLowerCase().includes(query)));
  const folderCount = (id: string) => mockups.filter((item) => String(item.folderId || "") === id).length;

  return (
    <>
      <style>{inlineStyles}</style>
      <main className="panel" data-frameforge-app>
      <header className="nativeHeader">
        <div><div className="eyebrow">FRAMEFORGE</div><h1>Frame library</h1></div>
        <div className="headerActions"><button className="ghostButton" type="button" title="Refresh library" aria-label="Refresh library" disabled={refreshing} onClick={() => void refreshLibrary(true)}>↻</button><button className="ghostButton" type="button" aria-expanded={showSettings} onClick={() => setShowSettings((value) => !value)}>Settings</button></div>
      </header>
      <div className="searchWrap"><span aria-hidden="true">⌕</span><input className="nativeSearch" type="search" value={search} placeholder="Search your frames" aria-label="Search frames" onChange={(event) => setSearch(event.currentTarget.value)} /></div>

      {showSettings && <section className="libraryControls">
        <label htmlFor="workerUrl">Cloudflare Worker URL</label>
        <input
          id="workerUrl"
          type="url"
          value={workerUrl}
          placeholder="https://frameforge-library.your-name.workers.dev"
          onChange={(event) => setWorkerUrl(event.currentTarget.value)}
        />
        <label htmlFor="adminToken">Admin token <span>(folders, move and delete)</span></label>
        <input
          id="adminToken"
          type="password"
          value={adminToken}
          placeholder="Enter for library management"
          autoComplete="off"
          onChange={(event) => {
            const value = event.currentTarget.value;
            setAdminToken(value);
            if (value) sessionStorage.setItem(TOKEN_KEY, value);
            else sessionStorage.removeItem(TOKEN_KEY);
          }}
        />
        <p className="securityNote">Admin access is session-only. Do not share this token with buyers or collaborators.</p>
        <div className="settingsActions">
          <button type="button" disabled={refreshing} onClick={() => void refreshLibrary(true)}>
            {refreshing ? "Refreshing…" : "Refresh library"}
          </button>
          <button className="clearTokenButton" type="button" disabled={!adminToken} onClick={() => { setAdminToken(""); sessionStorage.removeItem(TOKEN_KEY); setNotice({ tone: "positive", text: "Admin token cleared from this session." }); }}>Clear token</button>
        </div>
      </section>}

      <section className="folderPanel" aria-label="Library folders">
        <div className="folderToolbar">
          <div><strong>Folders</strong><span>{mockups.length} frames</span></div>
          <button className="newFolderButton" type="button" disabled={busy !== null} onClick={() => { setFolderDraft(""); setFolderDialog({ mode: "create" }); }}>＋ New folder</button>
        </div>
        <button className={`folderRow ${currentFolderId === null ? "active" : ""}`} type="button" aria-pressed={currentFolderId === null} onClick={() => setCurrentFolderId(null)}><span className="folderIcon">📚</span><span>All frames</span><b>{mockups.length}</b></button>
        <button className={`folderRow ${currentFolderId === "" ? "active" : ""}`} type="button" aria-pressed={currentFolderId === ""} onClick={() => setCurrentFolderId("")}><span className="folderIcon">📥</span><span>Uncategorized</span><b>{folderCount("")}</b></button>
        {folders.map((folder) => <div className="folderGroup" key={folder.id}>
          <button className={`folderRow ${currentFolderId === folder.id ? "active" : ""}`} type="button" aria-pressed={currentFolderId === folder.id} onClick={() => setCurrentFolderId(folder.id)}><span className="folderIcon">📁</span><span>{folder.name}</span><b>{folderCount(folder.id)}</b></button>
          <button className="iconButton" type="button" aria-label={`Rename ${folder.name}`} disabled={busy !== null} onClick={() => { setFolderDraft(folder.name); setFolderDialog({ mode: "rename", folder }); }}>•••</button>
          <button className="iconButton danger" type="button" aria-label={`Delete ${folder.name}`} disabled={busy !== null} onClick={() => setFolderDialog({ mode: "delete", folder })}>×</button>
        </div>)}
      </section>

      {folderDialog && <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busy === null) setFolderDialog(null); }}><section className="nativeDialog" role="dialog" aria-modal="true" aria-labelledby="folderDialogTitle"><h2 id="folderDialogTitle">{folderDialog.mode === "create" ? "Create folder" : folderDialog.mode === "rename" ? "Rename folder" : "Delete folder?"}</h2>{folderDialog.mode === "delete" ? <p>Frames in <strong>{folderDialog.folder?.name}</strong> will move to Uncategorized. No frame files will be deleted.</p> : <label>Folder name<input autoFocus value={folderDraft} maxLength={80} placeholder="e.g. Floral frames" onChange={(event) => setFolderDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && folderDraft.trim() && busy === null) folderDialog.mode === "create" ? void createFolder(folderDraft) : folderDialog.folder && void renameFolder(folderDialog.folder, folderDraft); }} /></label>}<div className="dialogActions"><button className="secondaryButton" type="button" disabled={busy !== null} onClick={() => setFolderDialog(null)}>Cancel</button>{folderDialog.mode === "delete" ? <button className="dangerButton" type="button" disabled={busy !== null} onClick={() => folderDialog.folder && void deleteFolder(folderDialog.folder)}>Delete folder</button> : <button type="button" disabled={busy !== null || !folderDraft.trim()} onClick={() => folderDialog.mode === "create" ? void createFolder(folderDraft) : folderDialog.folder && void renameFolder(folderDialog.folder, folderDraft)}>{busy ? "Saving…" : folderDialog.mode === "create" ? "Create" : "Save"}</button>}</div></section></div>}

      {mockups.some((item) => item.mode === "smart-mask") && <section className="smartControls">
        <h2>Smart Mask photo controls</h2>
        <p>{imageSelection.count ? "Selected Canva image will be updated." : "No image selected: a new masked image will be added."}</p>
        <label>Zoom {smartZoom.toFixed(2)}×<input type="range" min="1" max="4" step="0.05" value={smartZoom} onChange={(event)=>setSmartZoom(Number(event.currentTarget.value))}/></label>
        <label>Rotate {smartRotation}°<input type="range" min="-180" max="180" step="1" value={smartRotation} onChange={(event)=>setSmartRotation(Number(event.currentTarget.value))}/></label>
        <label>Pan X {smartPanX}%<input type="range" min="-100" max="100" step="1" value={smartPanX} onChange={(event)=>setSmartPanX(Number(event.currentTarget.value))}/></label>
        <label>Pan Y {smartPanY}%<input type="range" min="-100" max="100" step="1" value={smartPanY} onChange={(event)=>setSmartPanY(Number(event.currentTarget.value))}/></label>
        <button type="button" onClick={()=>{setSmartZoom(1);setSmartPanX(0);setSmartPanY(0);setSmartRotation(0)}}>Reset crop</button>
      </section>}

      {!canInsert && <div className="alert critical">This Canva design type does not support positioned elements.</div>}

      <div className="list">
        {visibleMockups.map((mockup) => (
          <section className="card" key={mockup.id}>
            <div className="preview" aria-hidden="true">
              {mockup.thumbUrl ? <img src={mockup.thumbUrl} alt="" /> : <span>FF</span>}
            </div>
            <div className="details">
              <div className="name">{mockup.name}</div>
              <div className="meta">{mockup.w} × {mockup.h}px · {mockup.mode === "smart-mask" ? "exact Smart Mask" : mockup.mode === "silhouette" ? (isExactMulti(mockup) ? `exact multi · ${mockup.paths.length} objects` : "silhouette") : "overlay"}</div>
              {(mockup.unbridgedHoles ?? 0) > 0 && (
                <div className="holeWarning" title="Canva native paths allow exactly one M, so a fully enclosed hole cannot be cut out. Republish this frame as a Smart Mask to keep the holes.">
                  ⚠ {mockup.unbridgedHoles} enclosed hole{(mockup.unbridgedHoles ?? 0) > 1 ? "s" : ""} will insert filled — use Smart Mask for an exact cut-out
                </div>
              )}
              <select className="moveSelect" aria-label={`Move ${mockup.name} to folder`} value={mockup.folderId || ""} disabled={busy !== null} onChange={(event) => void moveMockup(mockup, event.currentTarget.value)}><option value="">Uncategorized</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
              {mockup.mode === "smart-mask" && <input className="photoPick" aria-label={`Photo for ${mockup.name}`} type="file" accept="image/*" onChange={(event) => { const file = event.currentTarget.files?.[0] ?? null; setSmartFiles((current) => ({ ...current, [mockup.id]: file })); }}/>} 
            </div>
            <div className="cardActions">
              <button type="button" disabled={!canInsert || busy !== null || (mockup.mode === "smart-mask" && !smartFiles[mockup.id])} aria-busy={busy === mockup.id} onClick={() => void insert(mockup)}>
                {busy === mockup.id ? "Working…" : (mockup.mode === "smart-mask" && imageSelection.count ? "Update" : "Add")}
              </button>
              {confirmDeleteId === mockup.id ? (
                <>
                  <button className="confirmDeleteButton" type="button" disabled={busy !== null} aria-busy={busy === `delete:${mockup.id}`} onClick={() => void deleteMockup(mockup)}>
                    {busy === `delete:${mockup.id}` ? "Deleting…" : "Confirm"}
                  </button>
                  <button className="cancelDeleteButton" type="button" disabled={busy !== null} onClick={() => setConfirmDeleteId(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="deleteButton" type="button" disabled={busy !== null} onClick={() => setConfirmDeleteId(mockup.id)}>
                  Delete
                </button>
              )}
            </div>
          </section>
        ))}
        {!visibleMockups.length && <div className="emptyState">No frames in this folder.</div>}
      </div>

      {notice && <div className={`alert ${notice.tone}`}>{notice.text}</div>}

      <footer className="tip"><strong>Folders v7.2:</strong> Create and organize here. Creator flow: Fit canvas in FrameForge → Publish to Canva Dev → Refresh library here → Add.</footer>
      </main>
    </>
  );
}
