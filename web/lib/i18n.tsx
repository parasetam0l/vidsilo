// i18n-ready UI: one typed messages dict + a t() helper. `en` ships;
// adding a locale is one dict + one entry in `locales`.
"use client";

import * as React from "react";

export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];

const en = {
  // app
  appName: "VOD",
  appTitle: "VOD Admin",
  error: "Something went wrong",
  deleted: "Deleted",
  appVersion: "v0.1.0",
  loading: "Loading…",
  save: "Save",
  saved: "Saved",
  cancel: "Cancel",
  close: "Close",
  reset: "Reset",
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
  navJobs: "Jobs",
  navAnalytics: "Analytics",
  navCategories: "Categories",
  navFlavors: "Flavors",
  navDomainAcls: "Domain ACL",
  navSettings: "Settings",
  navSignIn: "Sign in",
  langLabel: "Language",
  langEnglish: "English",
  signOut: "Sign out",
  signOutTitle: "Sign out?",
  signOutDesc: "You will be signed out of this session.",
  darkMode: "Dark mode",
  lightMode: "Light mode",
  appearance: "Appearance",
  editUserTitle: "Edit user",
  editCategoryTitle: "Edit category",
  userUpdated: "User updated",
  categoryCreated: "Category created",
  categoryUpdated: "Category updated",
  flavorCreated: "Flavor created",
  flavorUpdated: "Flavor updated",
  changePassword: "Change password",
  changePasswordTitle: "Change password",
  changePasswordDesc: "Other signed-in sessions will be signed out.",
  currentPassword: "Current password",
  newPassword: "New password",
  confirmPassword: "Confirm new password",
  passwordKeep: "leave blank to keep the current password",
  passwordChanged: "Password updated",

  // login
  loginTitle: "Sign in to VOD",
  loginPrompt: "Please sign in to continue.",
  loginEmail: "Email",
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
  dashWelcomeTitle: "Welcome to VOD",
  dashWelcomeDesc:
    "Your library is empty — upload your first video to start building your catalog.",
  dashUploadFirst: "Upload a video",
  dashStatusEmpty: "Nothing to report yet — statuses will appear here.",
  dashActivity: "Active uploads & jobs",
  dashActivityEmpty: "Nothing processing right now.",
  dashUploadingBy: "uploading by {email}",
  jobRunning: "Processing",
  jobQueued: "In Queue",
  jobDone: "Done",
  jobProbe: "Probe",
  jobTranscode: "Transcode",
  jobRetry: "Retry",
  jobRetried: "Job requeued",
  jobsEmpty: "No jobs yet — uploads and reprocessing appear here.",
  colType: "Type",
  colPlays: "Plays",
  colWatchTime: "Watch time",
  colBandwidth: "Bandwidth",
  actOpen: "Open",
  actEmbed: "Embed",
  embedTitle: "Embed this video",
  analyticsTopEntries: "Top entries",
  analyticsEmpty: "No viewing data yet — views will appear here.",
  colEntry: "Entry",
  colAttempts: "Attempts",
  colError: "Error",
  dashRecentEmpty: "No videos yet — uploads will show up here.",
  dashByStatus: "Entries by status",
  dashNoEntries: "No entries yet — upload your first video.",
  dashRecent: "Recent uploads",
  dashRecentDesc: "The latest videos added to your catalog.",
  colTitle: "Title",
  colStatus: "Status",
  statusUploading: "Uploading",
  statusProbing: "Probing",
  statusTranscoding: "Transcoding",
  statusReady: "Ready",
  statusFailed: "Failed",
  colDuration: "Duration",
  colCategory: "Category",
  colSize: "Size",
  colUploaded: "Uploaded",
  colName: "Name",
  colNameSurname: "Name & Surname",
  colEmail: "Email",
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
  entriesReprocessN: "Reprocess ({n})",
  entriesReprocessTitle: "Reprocess {n} entries?",
  entriesReprocessDesc: "The processing pipeline will re-run for the selected entries.",
  entriesReprocessed: "Reprocessing {n} entries",
  entriesEmpty: "No entries match your filters.",
  entriesNoneTitle: "No entries yet",
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
  reprocessTitle: "Reprocess this entry?",
  reprocessDesc:
    "Probing and transcoding will re-run with the current flavor selection. Existing media is replaced.",
  reprocessQueued: "Reprocessing queued — entry status will update shortly.",
  entryDeleteTitle: "Delete this entry?",
  entryDeleteDesc:
    "The entry and all its media (original file, quality presets, posters, analytics) will be permanently removed.",
  reprocessHint:
    "Re-runs probing and transcoding with the currently ticked flavors.",
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
  noSprite: "No preview frames yet — they're generated during processing. Reprocess the entry if it is ready and this stays empty.",
  posterScrubHint:
    "Scrub through video frames to pick a custom thumbnail poster — the footer Save applies it.",
  chgPoster: "Poster",
  chgPosterFrame: "frame {n}",
  noSubtitles: "No subtitles",
  uploadVtt: "Upload .vtt",
  subtitleUploaded: "Subtitle uploaded",
  deleteSubtitleTitle: "Delete subtitle?",
  deleteSubtitleDesc: "This removes the subtitle track from the entry.",
  labelEmbedPolicy: "Embed security",
  allowAll: "Allow All",
  embedSnippet: "Embed snippet",
  copy: "Copy",
  copied: "Copied",
  flavorsLockedHint:
    "During processing, flavors cannot be changed.",
  unsavedChanges: "Unsaved changes",
  changesTitle: "Review changes",
  changesDesc: "These changes will be saved:",
  chgTitle: "Title",
  chgDesc: "Description",
  chgCategory: "Category",
  chgVisibility: "Visibility",
  chgAcl: "Embed security",
  chgFlavors: "Flavors",
  visibilityPublic: "public",
  visibilityPrivate: "private",
  colVisibility: "Visibility",
  accessAllowed: "Allowed",
  accessDenied: "Denied",
  labelDenyAccess: "Deny access",
  denyAccessHint:
    "Hide the video from all viewers without deleting it. Editors and admins can still manage it.",
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
  uploadOrClick: "or click to browse — up to {max}",
  uploadDone: "Upload complete",
  uploadFailed: "Upload failed: {error}",
  uploadStart: "Start upload",
  uploadDialogTitle: "Upload videos",
  uploadInProgressTitle: "Uploading…",
  uploadInProgressDesc:
    "Transfers keep running after you close this dialog.",
  uploadCancelAll: "Cancel All",
  uploadCancelAllTitle: "Cancel everything?",
  uploadCancelAllDesc:
    "All pending uploads and URL downloads will be stopped. Files already uploaded stay on the server; the rest are discarded.",
  uploadTabComputer: "Upload from Computer",
  uploadTabUrl: "Download from URL",
  uploadUrlHint: "Paste video URLs, one per line, then Check URLs.",
  uploadUrlPlaceholder: "https://example.com/video.mp4\nhttps://cdn.example.org/clip.mov",
  uploadCheckUrls: "Check URLs",
  uploadUrlInvalid: "Some URLs were rejected — check the format and file type.",
  uploadDownloading: "Downloading…",
  uploadPleaseWait: "Please wait…",
  uploadStartDownloadN: "Start download {n} item{s}",
  uploadUrlRowHint: "Enter each URL on a new row.",
  uploadBackgroundNote: "You can close this dialog — downloads continue in the background.",
  uploadsInProgress: "{n} upload{s} in progress",
  uploadInterrupted: "paused — continues automatically when you start the upload",
  uploadStartN: "Upload {n} file{s}",
  uploadAddMore: "Add more",
  uploadFilesSelected: "{n} file{s} selected",
  uploadInProgress: "Uploading…",
  uploadAllComplete: "All uploads complete.",
  uploadBatchLimit: "You can upload up to {n} files at once.",
  uploadDuplicate: "The file you selected is already in the list.",
  uploadStopTitle: "Stop this upload?",
  uploadStopDesc:
    "The transfer stops and the partially uploaded file is discarded. The empty entry can be deleted from the Entries page.",
  uploadStop: "Stop upload",
  uploadDiscardTitle: "Discard unstarted uploads?",
  uploadDiscardDesc:
    "Files that haven't started uploading/downloading will be discarded. Running transfers continue in the background.",
  uploadDiscardConfirm: "Discard & Close",
  uploadDiscardCancel: "Keep Editing",

  // users
  usersTitle: "Users",
  usersSubtitle: "Roles: admin, editor, uploader, viewer",
  usersNew: "New user",
  statusActive: "active",
  statusDisabled: "disabled",
  newUserTitle: "New user",
  userCreated: "User created",
  deleteUserTitle: "Delete user?",
  deleteUserDesc: "This permanently removes the account for {email}.",

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
    "Video quality presets — only enabled ones are produced; presets larger than the source are skipped",
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
  flavorEnabled: "Flavor enabled",
  flavorDisabled: "Flavor disabled",
  deleteFlavorTitle: "Delete flavor?",
  deleteFlavorDesc: "This removes the quality preset. Existing output files are kept.",

  // domain ACLs
  aclNew: "New domain ACL",
  aclEditTitle: "Edit domain ACL",
  aclCreated: "Domain ACL created",
  aclUpdated: "Domain ACL updated",
  aclDeleteTitle: "Delete domain ACL?",
  aclDeleteDesc:
    "Entries using this ACL fall back to \"Allow All\" (embeds allowed anywhere).",
  aclColTitle: "Title",
  aclColWhitelist: "Whitelist",
  aclColBlocklist: "Blocklist",
  aclDomainsPlaceholder: "example.com\nsub.example.org",
  aclEmpty: "No domain ACLs yet — create one to restrict where entries can be embedded.",

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
  gTls: "TLS",
  gTlsDesc: "Auto-HTTPS via Let's Encrypt — restart required",
  settingsSave: "Save {group}",

  // player
  playerError: "Playback failed — try again later.",
  playerPlay: "Play",
  playerPause: "Pause",
  playerMute: "Mute",
  playerUnmute: "Unmute",
  playerFullscreen: "Fullscreen",
  playerExitFullscreen: "Exit fullscreen",
  playerSpeed: "Speed",
  playerPictureInPicture: "Picture in picture",
  playerAuto: "Auto",
  playerOff: "Off",
  playerVideoStatus: "This video isn't ready to watch yet — check back shortly.",
  playerMissingId: "Missing entry id in URL",
  videoUnavailable: "Video is unavailable.",
  previewUnavailable: "Preview Not Available",
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
        const enrichedVars =
          vars.n !== undefined && vars.s === undefined
            ? { ...vars, s: Number(vars.n) === 1 ? "" : "s" }
            : vars;
        for (const [k, v] of Object.entries(enrichedVars)) {
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
