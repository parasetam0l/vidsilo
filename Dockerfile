# ---- web: static export -----------------------------------------------------
FROM node:24 AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- build: go binary embedding the UI --------------------------------------
FROM golang:1.26 AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /app/web/out internal/ui/web/out
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/vod-app ./cmd/vod-app

# ---- runtime: ubuntu + ffmpeg -----------------------------------------------
FROM ubuntu:24.04
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -encoders 2>/dev/null | grep -q libx264 \
    && ffmpeg -encoders 2>/dev/null | grep -q libx265 \
    || { echo "libx264/libx265 encoders missing"; exit 1; }
RUN useradd --system --create-home --uid 1000 vod
USER vod
WORKDIR /data
VOLUME /data
COPY --from=build /out/vod-app /usr/local/bin/vod-app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
ENTRYPOINT ["/usr/local/bin/vod-app"]
CMD ["server"]
