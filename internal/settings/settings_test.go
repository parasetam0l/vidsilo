package settings

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/parasetam0l/vidsilo/internal/db"
	"github.com/parasetam0l/vidsilo/internal/testdb"
)

// Two services sharing one Postgres simulate two app nodes: an update made
// through node A must reach node B via the periodic reload.
func TestCrossNodePropagation(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	db.MustSeed(ctx, pool, nil)

	nodeA, err := New(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	nodeB, err := New(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}

	stopB := make(chan struct{})
	ctxB, cancelB := context.WithCancel(ctx)
	go func() {
		nodeB.Run(ctxB, 50*time.Millisecond)
		close(stopB)
	}()
	defer func() {
		cancelB()
		<-stopB
	}()

	if nodeB.String("site_name", "") != "Vidsilo" {
		t.Fatalf("node B initial site_name = %q", nodeB.String("site_name", ""))
	}

	raw, _ := json.Marshal("ClusterVidsilo")
	if err := nodeA.Update(ctx, "site_name", raw); err != nil {
		t.Fatal(err)
	}
	if nodeB.String("site_name", "") == "ClusterVidsilo" {
		t.Fatal("node B saw the update before any reload (impossible)")
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if nodeB.String("site_name", "") == "ClusterVidsilo" {
			return // propagated via Run
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("node B never picked up the settings change")
}

// Two concurrent bootstraps (migrations + seeds) on one database must
// serialize via the advisory lock and both succeed.
func TestConcurrentBootstrap(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)

	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					errs <- r.(error)
				}
			}()
			db.MustSeed(ctx, pool, nil)
			errs <- nil
		}()
	}
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent bootstrap failed: %v", err)
		}
	}
	// Both succeeded and the schema is intact.
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("schema broken after concurrent bootstrap: %v", err)
	}
}
