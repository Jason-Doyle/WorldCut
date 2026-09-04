// Package adapters captures native resource-version metadata from Git, HTTP,
// and Kubernetes as WorldCut observations.
//
// The adapters only record version material that a provider actually exposes.
// They never manufacture dependency or validity relationships, and every
// failure is returned as an error rather than as a success-shaped observation.
package adapters

import (
	"errors"
	"fmt"
	"time"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
	"github.com/Jason-Doyle/WorldCut/ports/go/internal/idgen"
)

func observedAt(clock func() time.Time) string {
	if clock == nil {
		clock = time.Now
	}
	return worldcut.FormatTimestamp(clock())
}

func observationID(prefix string, source func() (string, error)) (string, error) {
	if source == nil {
		source = idgen.UUIDv4
	}
	value, err := source()
	if err != nil {
		return "", fmt.Errorf("generate observation identifier: %w", err)
	}
	if value == "" {
		return "", errors.New("observation identifier source returned an empty value")
	}
	return prefix + "-" + value, nil
}

func acquisitionCost(cost *int64) (int64, error) {
	if cost == nil {
		return 1, nil
	}
	if *cost < 0 || *cost > worldcut.MaxAcquisitionCost {
		return 0, fmt.Errorf(
			"acquisitionCost must be an integer between 0 and %d",
			worldcut.MaxAcquisitionCost,
		)
	}
	return *cost, nil
}

func requireText(value, field string) error {
	if value == "" {
		return fmt.Errorf("%s must not be empty", field)
	}
	return nil
}

func requireResource(resource worldcut.ResourceIdentity) error {
	fields := []struct {
		name  string
		value string
	}{
		{"resource.provider", resource.Provider},
		{"resource.account", resource.Account},
		{"resource.kind", resource.Kind},
		{"resource.key", resource.Key},
	}
	for _, field := range fields {
		if err := requireText(field.value, field.name); err != nil {
			return err
		}
	}
	return nil
}
