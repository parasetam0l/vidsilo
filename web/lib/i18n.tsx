// i18n-ready UI: one typed messages dict + a t() helper. `en` ships;
// adding a locale is one dict + one entry in `locales`.
"use client";

import * as React from "react";

export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];

const en = {
  // app
  appName: "VOD",
  error: "Something went wrong",
  deleted: "Deleted",
  appVersion: "v0.1.0",
  loading: "Loading…",
  save: "Save",
  saved: "Saved",
  cancel: "Cancel",
  delete: "Delete",
  create: "Create",
  edit: "Edit",
  none: "None",
  untitled: "(untitled)",

  // sidebar / nav
  navMedia: "Media",
  navDashboard: "Dashboard",
  navEntries: "Entries",
  navUpload: "Upload",
  navAdministration: "Administration",
  navUsers: "Users",
  navCategories: "Categories",
  navFlavors: "Flavors",
  navSettings: "Settings",
  navSignIn: "Sign in",
  langLabel: "Language",
  langEnglish: "English",

  // login
  loginTitle: "Sign in to VOD",
  loginPrompt: "Please sign in to continue.",
  loginUsername: "Username",
  loginPassword: "Password",
  loginButton: "Sign in",
  loginSigningIn: "Signing in…",
  loginFailed: "Sign in failed — try again.",

  // dashboard
  dashEntries: "Entries",
  dashEntriesHint: "total in catalog",
  dashStorage: "Storage used",
  dashStorageHint: "media across all entries",
  dashQueue: "Queue depth",
  dashQueueHint: "jobs waiting or running",
  dashBandwidth: "Bandwidth",
  dashBandwidthHint: "view traffic — {today} GB served today",
  analyticsDisabled: "Analytics is disabled — bandwidth is not being counted.",
  dashByStatus: "Entries by status",
  dashNoEntries: "No entries yet — upload your first video.",
  dashRecent: "Recent uploads",
  colTitle: "Title",
  colStatus: "Status",
  colDuration: "Duration",
  colCategory: "Category",
  colSize: "Size",
  colUploaded: "Uploaded",
  colName: "Name",
  colSlug: "Slug",
  colParent: "Parent",
  colRole: "Role",
  colCreated: "Created",
  colActions: "Actions",
  colEnabled: "Enabled",
  colCodec: "Codec",
  colHeight: "Height",
  colVideo: "Video",
  colAudio: "Audio",
  colFlavor: "Flavor",
  colNote: "Note",
  dashEmpty: "Nothing here yet",

  // entries list
  entriesSearch: "Search title or description…",
  entriesAllStatuses: "All statuses",
  entriesAllCategories: "All categories",
  entriesDeleteN: "Delete ({n})",
  entriesEmpty: "No entries match",
  entriesCount: "{total} entries · page {page} of {pages}",
  entriesPrev: "Prev",
  entriesNext: "Next",
  entriesDeleteTitle: "Delete {n} entries?",
  entriesDeleted: "Deleted {n} entries",
  entriesDeleteDesc:
    "This permanently removes the entries and their media from storage. This cannot be undone.",

  // entry detail
  entryMetaLine: "{category} · {duration} · {size} · uploaded {date}{by}",
  entryWatch: "Watch",
  entryReprocess: "Reprocess",
  entryDeleteTitle: "Delete this entry?",
  entryDeleteDesc:
    "The entry and all its media (original, renditions, posters, analytics) will be permanently removed.",
  tabMetadata: "Metadata",
  tabFlavors: "Flavors",
  tabPoster: "Poster",
  tabSubtitles: "Subtitles",
  tabPlayback: "Playback",
  tabAnalytics: "Analytics",
  labelTitle: "Title",
  labelCategory: "Category",
  labelDescription: "Description",
  labelPublic: "Public (browseable without sign-in)",
  labelTick: "Tick",
  labelLang: "Lang",
  labelSubtitleLabel: "Label",
  labelFrame: "Frame {n}",
  notTicked: "not ticked",
  noSprite: "No sprite sheet yet — the probe job generates one. Reprocess the entry if it is ready and this is still empty.",
  useAsPoster: "Use as poster",
  posterSaved: "Poster updated",
  noSubtitles: "No subtitles",
  uploadVtt: "Upload .vtt",
  subtitleUploaded: "Subtitle uploaded",
  deleteSubtitleTitle: "Delete subtitle?",
  deleteSubtitleDesc: "This removes the subtitle track from the entry.",
  labelEmbedPolicy: "Embed policy",
  embedDefault: "Default (global)",
  embedAnywhere: "Anywhere",
  embedSameOrigin: "Same origin",
  embedAllowlist: "Allowlist",
  allowedDomains: "Allowed domains (comma separated, subdomains match)",
  savePolicy: "Save policy",
  embedSnippet: "Embed snippet",
  copy: "Copy",
  copied: "Copied",
  saveFlavorsReprocess: "Save flavors & reprocess",
  statPlays: "Plays",
  statViewers: "Unique viewers",
  statWatchTime: "Watch time",
  statBandwidth: "Bandwidth",
  chartPlays: "Plays per day",
  chartWatch: "Watch minutes per day",
  chartBandwidth: "Bandwidth (GB) per day",
  noData: "No data yet.",
  entryNotFound: "No entry selected.",

  // upload
  uploadDragDrop: "Drag & drop videos here",
  uploadOrClick:
    "or click to browse — resumable via tus, up to 8 GiB",
  uploadDone: " — done, opening entries…",
  uploadFailed: " — failed: {error}",
  uploadStart: "Start upload",
  uploadStartN: "Upload {n} file{s}",
  uploadHowTitle: "How it works",
  uploadHowDesc:
    "Files upload straight to media storage with the tus resumable protocol — safe to close and reopen the browser mid-upload. After completion, the probe job inspects the source, generates a poster + sprite sheet, and the transcode job builds adaptive HLS renditions.",

  // users
  usersTitle: "Users",
  usersSubtitle: "Roles: admin, editor, uploader, viewer",
  usersNew: "New user",
  statusActive: "active",
  statusDisabled: "disabled",
  newUserTitle: "New user",
  userCreated: "User created",
  deleteUserTitle: "Delete user?",
  deleteUserDesc: "This permanently removes the account for {username}.",

  // categories
  categoriesTitle: "Categories",
  categoriesSubtitle: "Tree structure for organizing entries",
  newCategory: "New category",
  parentNone: "Parent (none)",
  deleteCategoryTitle: "Delete category?",
  deleteCategoryDesc: "Entries in this category will become uncategorized.",

  // flavors
  flavorsTitle: "Flavors",
  flavorsSubtitle:
    "Transcode renditions — only enabled flavors are built; flavors taller than the source are skipped",
  flavorsNew: "New flavor",
  newFlavorTitle: "New flavor",
  editFlavorTitle: "Edit flavor",
  codecH264: "H.264",
  codecH265: "H.265 (HEVC)",
  videoMode: "Video mode",
  vmodeCrf: "CRF (quality)",
  vmodeBitrate: "Bitrate (kbps)",
  labelCrf: "CRF",
  labelBitrate: "Bitrate (kbps)",
  labelAudioBitrate: "Audio bitrate (kbps)",
  labelPreset: "Preset",
  saveFlavor: "Save flavor",
  deleteFlavorTitle: "Delete flavor?",
  deleteFlavorDesc: "This removes the flavor definition. Existing renditions remain on disk.",

  // settings
  settingsRestart: "Restart required",
  settingsRestartDesc:
    "Changes to {keys} take effect after the server restarts (Docker: docker compose restart app).",
  settingsSaved: "Saved {keys}",
  gGeneral: "General",
  gGeneralDesc: "Site identity and upload rules",
  gStorage: "Storage",
  gStorageDesc: "S3 read-through cache settings",
  gTranscoding: "Transcoding",
  gTranscodingDesc: "Pipeline tuning — applies to newly processed entries",
  gAnalytics: "Analytics",
  gAnalyticsDesc: "Beacon collection and retention",
  gPlayback: "Playback",
  gPlaybackDesc: "Global default embed policy",
  gTls: "TLS",
  gTlsDesc: "Auto-HTTPS via Let's Encrypt — restart required",
  settingsSave: "Save {group}",

  // player
  playerError: "Playback error — check server logs",
  playerPlay: "Play",
  playerPause: "Pause",
  playerMute: "Mute",
  playerUnmute: "Unmute",
  playerFullscreen: "Fullscreen",
  playerExitFullscreen: "Exit fullscreen",
  playerSpeed: "Speed",
  playerAuto: "Auto",
  playerOff: "Off",
  playerVideoStatus: "Video is {status}",
  playerMissingId: "Missing entry id in URL",
} as const;

export type MessageKey = keyof typeof en;

const messages: Record<Locale, Record<MessageKey, string>> = { en };

interface I18nState {
  locale: Locale;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = React.createContext<I18nState>({
  locale: "en",
  t: (key) => messages.en[key],
  setLocale: () => {},
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(() => {
    if (typeof window === "undefined") return "en";
    const stored = localStorage.getItem("lang");
    return (locales as readonly string[]).includes(stored ?? "") ? (stored as Locale) : "en";
  });

  const t = React.useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      let out: string = messages[locale][key] ?? messages.en[key];
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replaceAll(`{${k}}`, String(v));
        }
      }
      return out;
    },
    [locale],
  );

  const setLocale = React.useCallback((next: Locale) => {
    localStorage.setItem("lang", next);
    setLocaleState(next);
  }, []);

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  return React.useContext(I18nContext).t;
}

export function useI18n() {
  return React.useContext(I18nContext);
}
