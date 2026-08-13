package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/tus/tusd/v2/pkg/handler"

	"github.com/parasetam0l/vidsilo/internal/upload"
)

// newTusHandler builds the tusd handler wired to the Vidsilo data store. The
// returned handler expects an authenticated request (role middleware applied
// by the caller) and records the uploader id into the datastore context.
func (s *Server) newTusHandler(ds *upload.DataStore) http.Handler {
	composer := handler.NewStoreComposer()
	composer.UseCore(ds)
	composer.UseTerminater(ds)

	unrouted, err := handler.NewUnroutedHandler(handler.Config{
		BasePath:        "/upload/",
		StoreComposer:   composer,
		MaxSize:         s.settings.Int64("upload.max_size_bytes", 8<<30),
		DisableDownload: true,
	})
	if err != nil {
		panic(err) // programmer error: config is static
	}

	// tusd's handler methods expect the base path already stripped from
	// r.URL.Path; Middleware handles protocol checks and method overrides.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := userFromContext(r.Context())
		ctx := context.WithValue(r.Context(), upload.CtxUserID, u.ID)
		r = r.WithContext(ctx)

		r2 := r.Clone(ctx)
		r2.URL.Path = "/" + strings.TrimPrefix(r.URL.Path, "/upload/")

		unrouted.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodPost:
				unrouted.PostFile(w, r)
			case http.MethodHead:
				unrouted.HeadFile(w, r)
			case http.MethodPatch:
				unrouted.PatchFile(w, r)
			case http.MethodDelete:
				unrouted.DelFile(w, r)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		})).ServeHTTP(w, r2)
	})
}
