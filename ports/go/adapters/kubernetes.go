package adapters

import (
	"time"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
)

// KubernetesObjectMetadata is the structural subset of Kubernetes object
// metadata WorldCut records. Empty Namespace defaults to "default" and an
// empty UID is recorded as null.
type KubernetesObjectMetadata struct {
	Name            string
	Namespace       string
	UID             string
	ResourceVersion string
}

// KubernetesObject is the structural subset of a Kubernetes object WorldCut
// records. No Kubernetes client library is required.
type KubernetesObject struct {
	APIVersion string
	Kind       string
	Metadata   KubernetesObjectMetadata
}

// KubernetesObservationOptions describes one Kubernetes object to capture.
type KubernetesObservationOptions struct {
	// Cluster names the cluster inside the resource key.
	Cluster string
	// Account is the caller-declared tenant or context account.
	Account string
	// Role binds the observation to a contract role.
	Role string
	// Object is the observed object.
	Object KubernetesObject
	// Value overrides the recorded observation value. A nil Value records the
	// object's structural identity. The supplied value is snapshotted, so
	// later mutation of caller maps or slices cannot change the observation.
	Value any
	// AcquisitionCost defaults to 1.
	AcquisitionCost *int64
	// Clock defaults to time.Now.
	Clock func() time.Time
	// NewID defaults to a random version 4 UUID.
	NewID func() (string, error)
}

// CaptureKubernetesObservation records metadata.resourceVersion as an opaque
// exact version token.
//
// The value is never parsed, sorted, compared for ordering, or interpreted as
// a timestamp, and no validity interval is inferred.
func CaptureKubernetesObservation(options KubernetesObservationOptions) (worldcut.Observation, error) {
	fields := []struct {
		name  string
		value string
	}{
		{"cluster", options.Cluster},
		{"account", options.Account},
		{"role", options.Role},
		{"object.apiVersion", options.Object.APIVersion},
		{"object.kind", options.Object.Kind},
		{"object.metadata.name", options.Object.Metadata.Name},
	}
	for _, field := range fields {
		if err := requireText(field.value, field.name); err != nil {
			return worldcut.Observation{}, err
		}
	}
	cost, err := acquisitionCost(options.AcquisitionCost)
	if err != nil {
		return worldcut.Observation{}, err
	}
	id, err := observationID("kubernetes", options.NewID)
	if err != nil {
		return worldcut.Observation{}, err
	}

	namespace := options.Object.Metadata.Namespace
	if namespace == "" {
		namespace = "default"
	}
	var value any
	if options.Value == nil {
		var uid any
		if options.Object.Metadata.UID != "" {
			uid = options.Object.Metadata.UID
		}
		value = map[string]any{
			"apiVersion": options.Object.APIVersion,
			"kind":       options.Object.Kind,
			"name":       options.Object.Metadata.Name,
			"namespace":  namespace,
			"uid":        uid,
		}
	} else {
		value, err = worldcut.SnapshotJSONValue(options.Value)
		if err != nil {
			return worldcut.Observation{}, err
		}
	}

	witness := worldcut.ObservationWitness{Provenance: "provider_asserted"}
	if options.Object.Metadata.ResourceVersion != "" {
		version := options.Object.Metadata.ResourceVersion
		witness.Version = &version
	}
	return worldcut.Observation{
		ID:   id,
		Role: options.Role,
		Resource: worldcut.ResourceIdentity{
			Provider: "kubernetes",
			Account:  options.Account,
			Kind:     options.Object.APIVersion + "/" + options.Object.Kind,
			Key:      options.Cluster + "/" + namespace + "/" + options.Object.Metadata.Name,
		},
		Value:           value,
		ObservedAt:      observedAt(options.Clock),
		AcquisitionCost: cost,
		Witness:         witness,
	}, nil
}
