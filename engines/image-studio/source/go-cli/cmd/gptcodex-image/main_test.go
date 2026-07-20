package main

import (
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestReadPNGMask(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "mask.png")
	file, err := os.Create(filePath)
	if err != nil {
		t.Fatal(err)
	}
	img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	img.SetNRGBA(0, 0, color.NRGBA{R: 255, G: 255, B: 255, A: 0})
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	encoded, normalized, err := readPNGMask(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if normalized == "" {
		t.Fatal("expected normalized path")
	}
	if _, err := base64.StdEncoding.DecodeString(encoded); err != nil {
		t.Fatalf("invalid base64: %v", err)
	}
}

func TestReadPNGMaskRejectsInvalidFile(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "mask.png")
	if err := os.WriteFile(filePath, []byte("not png"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readPNGMask(filePath); err == nil {
		t.Fatal("expected invalid PNG error")
	}
}
