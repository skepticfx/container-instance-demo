package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

var startedAt = time.Now().UTC().Format(time.RFC3339Nano)

type handler struct {
	logger *slog.Logger
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	hostname, _ := os.Hostname()
	response := map[string]any{
		"name":              os.Getenv("NAME"),
		"message":           os.Getenv("MESSAGE"),
		"path":              r.URL.RequestURI(),
		"hostname":          hostname,
		"durable_object_id": os.Getenv("DURABLE_OBJECT_ID"),
		"environment":       environment(),
		"started_at":        startedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(response); err != nil {
		h.logger.Error("Failed to write response", "error", err)
	}
}

func environment() map[string]string {
	env := make(map[string]string)
	for _, item := range os.Environ() {
		key, value, ok := strings.Cut(item, "=")
		if ok {
			env[key] = value
		}
	}
	return env
}

func main() {
	port := "8080"
	if len(os.Args) > 1 && os.Args[1] != "" {
		port = os.Args[1]
	}

	name := os.Getenv("NAME")
	if name == "" {
		name = "unknown"
	}

	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil)).With("name", name)
	server := &http.Server{
		Addr:    net.JoinHostPort("", port),
		Handler: &handler{logger: logger},
	}

	logger.Info("Server listening", "address", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error(fmt.Sprintf("Server stopped: %v", err))
		os.Exit(1)
	}
}
