package db

import (
	"strings"
	"time"
)

type Role string

const (
	RoleAdmin    Role = "admin"
	RoleEditor   Role = "editor"
	RoleUploader Role = "uploader"
	RoleViewer   Role = "viewer"
)

type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	Surname      string    `json:"surname"`
	PasswordHash string    `json:"-"`
	Role         Role      `json:"role"`
	Disabled     bool      `json:"disabled"`
	CreatedAt    time.Time `json:"createdAt"`
}

// DisplayName returns "Name Surname" (falling back to the email).
func (u User) DisplayName() string {
	if u.Name == "" && u.Surname == "" {
		return u.Email
	}
	return strings.TrimSpace(u.Name + " " + u.Surname)
}

type Category struct {
	ID       int64     `json:"id"`
	ParentID *int64    `json:"parentId"`
	Name     string    `json:"name"`
	Slug     string    `json:"slug"`
	Position int       `json:"position"`
	Children []Category `json:"children,omitempty"`
}

type Flavor struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	Label        string  `json:"label"`
	Codec        string  `json:"codec"`
	Height       int     `json:"height"`
	VideoMode    string  `json:"videoMode"`
	CRF          *float64 `json:"crf"`
	VideoBitrate *int    `json:"videoBitrate"`
	AudioBitrate int     `json:"audioBitrate"`
	Preset       string  `json:"preset"`
	Enabled      bool    `json:"enabled"`
	Position     int     `json:"position"`
}

type EntryStatus string

const (
	StatusUploading   EntryStatus = "uploading"
	StatusProbing     EntryStatus = "probing"
	StatusTranscoding EntryStatus = "transcoding"
	StatusReady       EntryStatus = "ready"
	StatusFailed      EntryStatus = "failed"
)

type EmbedPolicy string

const (
	EmbedDefault   EmbedPolicy = "default"
	EmbedAll       EmbedPolicy = "*"
	EmbedSameOrigin EmbedPolicy = "same-origin"
	EmbedAllowlist EmbedPolicy = "allowlist"
)

type Entry struct {
	// ID is the internal sequential id: used for FKs, jobs, analytics and
	// storage keys only. Never exposed in API JSON.
	ID           int64       `json:"-"`
	PublicID     string      `json:"id"`
	CategoryID   *int64      `json:"categoryId"`
	UploadedBy   *int64      `json:"uploadedBy"`
	Title        string      `json:"title"`
	Description  string      `json:"description"`
	Status       EntryStatus `json:"status"`
	DurationMS   *int64      `json:"durationMs"`
	SourceKey    string      `json:"sourceKey"`
	SourceSize   *int64      `json:"sourceSize"`
	IsPublic     bool        `json:"isPublic"`
	EmbedPolicy  EmbedPolicy `json:"embedPolicy"`
	EmbedDomains []string    `json:"embedDomains"`
	PosterKey    string      `json:"posterKey"`
	SpriteKey    string      `json:"spriteKey"`
	SpriteFrames int         `json:"spriteFrames"`
	Error        string      `json:"error,omitempty"`
	CreatedAt    time.Time   `json:"createdAt"`
	UpdatedAt    time.Time   `json:"updatedAt"`
}

type EntryFlavorStatus string

const (
	FlavorPending EntryFlavorStatus = "pending"
	FlavorDone    EntryFlavorStatus = "done"
	FlavorFailed  EntryFlavorStatus = "failed"
	FlavorSkipped EntryFlavorStatus = "skipped"
)

type EntryFlavor struct {
	EntryID    int64             `json:"-"`
	FlavorID   int64             `json:"flavorId"`
	Status     EntryFlavorStatus `json:"status"`
	Error      string            `json:"error,omitempty"`
	PlaylistKey string           `json:"playlistKey"`
}

type Subtitle struct {
	ID      int64  `json:"id"`
	Lang    string `json:"lang"`
	Label   string `json:"label"`
	VTTKey  string `json:"vttKey"`
}

type Job struct {
	ID          int64     `json:"id"`
	Type        string    `json:"type"`
	EntryID     *int64    `json:"entryId"`
	Payload     []byte    `json:"payload"`
	Status      string    `json:"status"`
	Attempts    int       `json:"attempts"`
	MaxAttempts int       `json:"maxAttempts"`
	Error       string    `json:"error,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}
