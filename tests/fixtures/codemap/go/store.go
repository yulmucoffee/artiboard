// Package store keeps board tasks in memory for the tests.
package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	jsonlib "github.com/example/jsonfast"
	_ "embed"
	"github.com/example/board/internal/tasks"
)

import "strings"

// func commented() {}

/*
func blockCommented() {}
type Hidden struct{}
*/

const (
	DefaultLimit = 50
	maxBatch     = 200
)

var ErrMissing = fmt.Errorf("missing %s", "task")

var lookup, cache = map[string]int{}, 0

const Version string = "func fake"

// Store holds tasks by key.
type Store struct {
	mu sync.Mutex
	Base
	tasks.Index
	limit int
}

type Base struct {
	Name string `json:"name"`
}

type Reader interface {
	Read(p []byte) (int, error)
	fmt.Stringer
}

type Count int

func New(limit int) *Store {
	if limit <= 0 {
		limit = DefaultLimit
	}
	return &Store{limit: limit}
}

func (s *Store) Put(ctx context.Context, key string, v int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	lookup[key] = v
	return nil
}

func (s Store) Size() int {
	return len(lookup)
}

func (s *Store) Dump() string {
	raw := `func inRaw() {
type Fake struct{}
`
	out, _ := json.Marshal(Count(len(raw)))
	fmt.Println("struct Fake", tasks.Index{}, jsonlib.Name('"'))
	return string(out) + helper()
}

func helper() string {
	return strings.ToUpper(fmt.Sprint(ErrMissing))
}

func init() {
	fmt.Print('x')
}

var (
	limitA, limitB = 1, 2
	build          = configure(
		"x",
	)
)
