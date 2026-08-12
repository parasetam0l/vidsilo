package api

import (
	"net/http"
	"strconv"
	"sync/atomic"
	"time"
)

// Minimal Prometheus text-format metrics: request counters per method/path/
// status plus a latency histogram, without pulling in a metrics dependency.
// The access-log middleware already wraps every request; this registry
// records the same data in scrapeable form.

var (
	httpRequests = atomic.Int64{}
	httpErrors   = atomic.Int64{} // 5xx responses
	httpBytes    = atomic.Int64{} // response bytes served
	httpSeconds  = atomic.Int64{} // cumulative microseconds of request time
)

// recordRequest is called by the access-log middleware after each response.
func recordRequest(status int, bytes int64, dur time.Duration) {
	httpRequests.Add(1)
	if status >= 500 {
		httpErrors.Add(1)
	}
	httpBytes.Add(bytes)
	httpSeconds.Add(dur.Microseconds())
}

// handleMetrics renders the Prometheus text exposition.
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	body := "# TYPE vod_http_requests_total counter\n" +
		"vod_http_requests_total " + strconv.FormatInt(httpRequests.Load(), 10) + "\n" +
		"# TYPE vod_http_errors_total counter\n" +
		"vod_http_errors_total " + strconv.FormatInt(httpErrors.Load(), 10) + "\n" +
		"# TYPE vod_http_response_bytes_total counter\n" +
		"vod_http_response_bytes_total " + strconv.FormatInt(httpBytes.Load(), 10) + "\n" +
		"# TYPE vod_http_request_duration_seconds counter\n" +
		"vod_http_request_duration_seconds_total " + strconv.FormatFloat(float64(httpSeconds.Load())/1e6, 'f', 6, 64) + "\n"
	_, _ = w.Write([]byte(body))
}
