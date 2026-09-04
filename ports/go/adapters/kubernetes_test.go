package adapters_test

import (
	"testing"
	"time"

	worldcut "github.com/Jason-Doyle/WorldCut/ports/go"
	"github.com/Jason-Doyle/WorldCut/ports/go/adapters"
)

func deploymentOptions() adapters.KubernetesObservationOptions {
	return adapters.KubernetesObservationOptions{
		Cluster: "fixture",
		Account: "test",
		Role:    "deployment",
		Object: adapters.KubernetesObject{
			APIVersion: "apps/v1",
			Kind:       "Deployment",
			Metadata: adapters.KubernetesObjectMetadata{
				Name:            "payments",
				Namespace:       "production",
				ResourceVersion: "9812",
			},
		},
	}
}

func TestCaptureKubernetesObservationKeepsResourceVersionOpaque(t *testing.T) {
	observation, err := adapters.CaptureKubernetesObservation(deploymentOptions())
	if err != nil {
		t.Fatal(err)
	}
	if observation.Witness.Version == nil || *observation.Witness.Version != "9812" {
		t.Fatalf("version = %v", observation.Witness.Version)
	}
	if observation.Resource.Kind != "apps/v1/Deployment" {
		t.Fatalf("resource kind = %s", observation.Resource.Kind)
	}
	if observation.Resource.Key != "fixture/production/payments" {
		t.Fatalf("resource key = %s", observation.Resource.Key)
	}
	if observation.Witness.Validity != nil {
		t.Fatal("the Kubernetes adapter must not infer a validity interval")
	}

	second, err := adapters.CaptureKubernetesObservation(deploymentOptions())
	if err != nil {
		t.Fatal(err)
	}
	if observation.ID == second.ID {
		t.Fatal("two captures produced the same observation identifier")
	}
}

func TestCaptureKubernetesObservationDefaultsNamespaceAndUID(t *testing.T) {
	options := deploymentOptions()
	options.Object.Metadata.Namespace = ""
	options.Object.Metadata.ResourceVersion = ""
	observation, err := adapters.CaptureKubernetesObservation(options)
	if err != nil {
		t.Fatal(err)
	}
	if observation.Resource.Key != "fixture/default/payments" {
		t.Fatalf("resource key = %s", observation.Resource.Key)
	}
	if observation.Witness.Version != nil {
		t.Fatal("an absent resourceVersion must not produce a version witness")
	}
	value := observation.Value.(map[string]any)
	if value["namespace"] != "default" || value["uid"] != nil {
		t.Fatalf("value = %#v", value)
	}
}

func TestCaptureKubernetesObservationSnapshotsCustomValues(t *testing.T) {
	custom := map[string]any{"replicas": 3, "labels": []any{"a"}}
	options := deploymentOptions()
	options.Value = custom
	observation, err := adapters.CaptureKubernetesObservation(options)
	if err != nil {
		t.Fatal(err)
	}
	custom["replicas"] = 9
	custom["labels"].([]any)[0] = "mutated"

	value := observation.Value.(map[string]any)
	if value["replicas"] != float64(3) {
		t.Fatalf("custom value aliased the caller's map: %#v", value)
	}
	if value["labels"].([]any)[0] != "a" {
		t.Fatalf("custom value aliased the caller's slice: %#v", value)
	}
}

func TestCaptureKubernetesObservationValidatesOptions(t *testing.T) {
	cases := map[string]func(*adapters.KubernetesObservationOptions){
		"missing cluster":     func(o *adapters.KubernetesObservationOptions) { o.Cluster = "" },
		"missing account":     func(o *adapters.KubernetesObservationOptions) { o.Account = "" },
		"missing role":        func(o *adapters.KubernetesObservationOptions) { o.Role = "" },
		"missing api version": func(o *adapters.KubernetesObservationOptions) { o.Object.APIVersion = "" },
		"missing kind":        func(o *adapters.KubernetesObservationOptions) { o.Object.Kind = "" },
		"missing name":        func(o *adapters.KubernetesObservationOptions) { o.Object.Metadata.Name = "" },
		"non-json value":      func(o *adapters.KubernetesObservationOptions) { o.Value = func() {} },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			options := deploymentOptions()
			mutate(&options)
			if _, err := adapters.CaptureKubernetesObservation(options); err == nil {
				t.Fatal("expected a rejection")
			}
		})
	}
}

func TestCaptureKubernetesObservationVerifies(t *testing.T) {
	options := deploymentOptions()
	options.Clock = func() time.Time { return time.Date(2026, 9, 4, 18, 0, 0, 0, time.UTC) }
	options.NewID = func() (string, error) { return "fixed", nil }
	observation, err := adapters.CaptureKubernetesObservation(options)
	if err != nil {
		t.Fatal(err)
	}
	if observation.ID != "kubernetes-fixed" || observation.ObservedAt != "2026-09-04T18:00:00.000Z" {
		t.Fatalf("observation = %+v", observation)
	}
	result, err := worldcut.VerifyDecisionContract(worldcut.VerificationInput{
		Contract: worldcut.Contract{
			ID:           "kubernetes",
			Version:      "1",
			DecisionTime: "2026-09-04T18:00:00.000Z",
			Requirements: []worldcut.Requirement{
				worldcut.NewValueEqualsRequirement(
					"namespace-is-production",
					"The object is in production",
					"deployment",
					[]string{"namespace"},
					"production",
				),
			},
		},
		Observations: []worldcut.Observation{observation},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Verdict != "CONTRACT_SATISFIED" {
		t.Fatalf("verdict = %s", result.Verdict)
	}
}
