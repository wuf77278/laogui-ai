package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"flag"
	"fmt"
	"image/png"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/yuanhua/image-gptcodex/internal/fsio"
	"github.com/yuanhua/image-gptcodex/internal/promptui"
	"github.com/yuanhua/image-gptcodex/pkg/client"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "发生错误:", err)
		os.Exit(1)
	}
}

func run() error {
	apiKey := flag.String("api-key", "", "GPTCODEX API key (overrides interactive prompt; env GPTCODEX_API_KEY also accepted)")
	baseURL := flag.String("base-url", "", "OpenAI-compatible upstream base URL (env GPTCODEX_BASE_URL also accepted)")
	apiMode := flag.String("api-mode", "", "responses | images (env GPTCODEX_API_MODE also accepted; default: responses)")
	responsesTransport := flag.String("responses-transport", "", "sse | websocket (Responses API only; env GPTCODEX_RESPONSES_TRANSPORT also accepted)")
	textModel := flag.String("text-model", "", "text model for Responses API (env GPTCODEX_TEXT_MODEL also accepted)")
	imageModel := flag.String("image-model", "", "image model ID (env GPTCODEX_IMAGE_MODEL also accepted)")
	mode := flag.String("mode", "", "generate | edit (overrides interactive prompt)")
	image := flag.String("image", "", "source image path (required for edit mode)")
	mask := flag.String("mask", "", "PNG mask path for edit mode; transparent pixels are editable")
	images := multiFlag{}
	flag.Var(&images, "reference-image", "source/reference image path for edit mode; repeatable")
	size := flag.String("size", "", "1024x1024 | 1536x1024 | 1024x1536 | 2048x1152")
	quality := flag.String("quality", "", "auto | high | medium | low")
	outputFormat := flag.String("output-format", "", "png | jpeg | webp (env GPTCODEX_OUTPUT_FORMAT also accepted; default: png)")
	background := flag.String("background", "", "auto | opaque | transparent (env GPTCODEX_BACKGROUND also accepted)")
	outputCompression := flag.Int("output-compression", client.DefaultOutputCompression, "jpeg/webp output compression 0-100")
	inputFidelity := flag.String("input-fidelity", "", "auto | low | high (env GPTCODEX_INPUT_FIDELITY also accepted)")
	moderation := flag.String("moderation", "", "low | auto (env GPTCODEX_MODERATION also accepted)")
	requestPolicy := flag.String("request-policy", "", "openai | compat (env GPTCODEX_REQUEST_POLICY also accepted)")
	reasoningEffort := flag.String("reasoning-effort", "", "low | medium | high | xhigh (Responses API only; env GPTCODEX_REASONING_EFFORT also accepted)")
	partialImages := flag.Int("partial-images", -1, "0-3 streaming partial previews for Images API; -1 keeps library default")
	disablePreview := flag.Bool("disable-preview", false, "force partial_images=0, matching Image Studio preview-off behavior")
	imagesNewAPICompat := flag.Bool("images-new-api-compat", false, "omit Images API stream/partial_images and force b64_json compatibility mode")
	autoRetryCount := flag.Int("auto-retry-count", 0, "extra retry attempts after the initial request; 0 keeps library default")
	noAutoRetry := flag.Bool("no-auto-retry", false, "disable automatic retry")
	prompt := flag.String("prompt", "", "prompt text (or edit instructions)")
	outDir := flag.String("out-dir", "", "output directory (default: ./images)")
	flag.Parse()

	if envKey := os.Getenv("GPTCODEX_API_KEY"); envKey != "" && *apiKey == "" {
		*apiKey = envKey
	}
	fillFromEnv(baseURL, "GPTCODEX_BASE_URL")
	fillFromEnv(apiMode, "GPTCODEX_API_MODE")
	fillFromEnv(responsesTransport, "GPTCODEX_RESPONSES_TRANSPORT")
	fillFromEnv(textModel, "GPTCODEX_TEXT_MODEL")
	fillFromEnv(imageModel, "GPTCODEX_IMAGE_MODEL")
	fillFromEnv(outputFormat, "GPTCODEX_OUTPUT_FORMAT")
	fillFromEnv(background, "GPTCODEX_BACKGROUND")
	fillFromEnv(inputFidelity, "GPTCODEX_INPUT_FIDELITY")
	fillFromEnv(moderation, "GPTCODEX_MODERATION")
	fillFromEnv(requestPolicy, "GPTCODEX_REQUEST_POLICY")
	fillFromEnv(reasoningEffort, "GPTCODEX_REASONING_EFFORT")

	fmt.Println("GPTCODEX 图片生成器")
	fmt.Println()

	p := promptui.NewPrompter()

	var err error
	if strings.TrimSpace(*apiKey) == "" {
		if *apiKey, err = p.APIKey(); err != nil {
			return err
		}
	}

	var resolvedMode client.Mode
	switch *mode {
	case "generate":
		resolvedMode = client.ModeGenerate
	case "edit":
		resolvedMode = client.ModeEdit
	case "":
		if resolvedMode, err = p.Mode(); err != nil {
			return err
		}
	default:
		return fmt.Errorf("--mode 必须是 generate 或 edit")
	}

	imagePaths := append([]string{}, images...)
	if *image != "" {
		imagePaths = append([]string{*image}, imagePaths...)
	}
	var imageDataURLs []string
	var sourceImagePaths []string
	var maskB64 string
	var maskPath string
	if resolvedMode == client.ModeEdit {
		if len(imagePaths) == 0 {
			sourceImagePath, err := p.ImagePath()
			if err != nil {
				return err
			}
			imagePaths = append(imagePaths, sourceImagePath)
		}
		for _, rawPath := range imagePaths {
			sourceImagePath, err := client.NormalizePath(rawPath)
			if err != nil {
				return err
			}
			imageDataURL, err := client.ImageFileToDataURL(sourceImagePath)
			if err != nil {
				return err
			}
			imageDataURLs = append(imageDataURLs, imageDataURL)
			sourceImagePaths = append(sourceImagePaths, sourceImagePath)
		}
	}
	if strings.TrimSpace(*mask) != "" {
		if resolvedMode != client.ModeEdit {
			return fmt.Errorf("--mask 只能用于 edit 模式")
		}
		maskB64, maskPath, err = readPNGMask(*mask)
		if err != nil {
			return err
		}
	}

	resolvedAPIMode, err := parseAPIMode(*apiMode)
	if err != nil {
		return err
	}
	resolvedResponsesTransport, err := parseResponsesTransport(*responsesTransport)
	if err != nil {
		return err
	}
	if strings.TrimSpace(*baseURL) == "" {
		return fmt.Errorf("--base-url 或 GPTCODEX_BASE_URL 必须提供")
	}
	if strings.TrimSpace(*outputFormat) == "" {
		*outputFormat = client.OutputFormat
	}
	switch *outputFormat {
	case "png", "jpeg", "jpg", "webp":
		if *outputFormat == "jpg" {
			*outputFormat = "jpeg"
		}
	default:
		return fmt.Errorf("--output-format 必须是 png、jpeg、jpg 或 webp")
	}
	resolvedRequestPolicy, err := parseRequestPolicy(*requestPolicy)
	if err != nil {
		return err
	}

	if *size == "" {
		if *size, err = p.Size(); err != nil {
			return err
		}
	}
	if *quality == "" {
		if *quality, err = p.Quality(); err != nil {
			return err
		}
	}
	if *prompt == "" {
		if *prompt, err = p.PromptText(resolvedMode); err != nil {
			return err
		}
	}

	transport, err := client.PickTransport()
	if err != nil {
		return err
	}

	output := *outDir
	if output == "" {
		output = fsio.DefaultOutputDir()
	}
	if err := fsio.EnsureDir(output); err != nil {
		return err
	}

	timestamp := time.Now().Format("20060102-150405")

	fmt.Println()
	actionLabel := "生成图片"
	if resolvedMode == client.ModeEdit {
		actionLabel = "编辑图片"
	}
	fmt.Printf("正在请求%s,比例 %s,质量 %s...\n", actionLabel, *size, *quality)
	for _, sourceImagePath := range sourceImagePaths {
		abs, _ := filepath.Abs(sourceImagePath)
		fmt.Printf("源图片:%s\n", abs)
	}
	if maskPath != "" {
		abs, _ := filepath.Abs(maskPath)
		fmt.Printf("蒙版图片:%s\n", abs)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	opts := client.Options{
		APIKey:             *apiKey,
		Prompt:             *prompt,
		Mode:               resolvedMode,
		Size:               *size,
		Quality:            *quality,
		OutputFormat:       *outputFormat,
		ImageDataURLs:      imageDataURLs,
		ImagePaths:         sourceImagePaths,
		MaskB64:            maskB64,
		APIMode:            resolvedAPIMode,
		ResponsesTransport: resolvedResponsesTransport,
		BaseURL:            *baseURL,
		TextModelID:        *textModel,
		ImageModelID:       *imageModel,
		Background:         *background,
		OutputCompression:  *outputCompression,
		InputFidelity:      *inputFidelity,
		Moderation:         *moderation,
		RequestPolicy:      resolvedRequestPolicy,
		ReasoningEffort:    *reasoningEffort,
		PartialImages:      *partialImages,
		DisablePreview:     *disablePreview,
		ImagesNewAPICompat: *imagesNewAPICompat,
		AutoRetryCount:     *autoRetryCount,
	}
	if *noAutoRetry {
		enabled := false
		opts.AutoRetryEnabled = &enabled
	}

	logger := func(msg string) {
		fmt.Println(msg)
	}
	progress := func(stage string, elapsed int, bytes int64) {
		fmt.Printf("已等待 %d 秒,状态:%s,已接收 %s...\n", elapsed, stage, client.FormatBytes(bytes))
	}

	result, rawPath, err := client.RequestAndExtractWithRetries(ctx, transport, opts, output, timestamp, logger, progress)
	if err != nil {
		return err
	}

	imageName := fsio.BuildImageName(resolvedMode, *prompt, timestamp, opts.OutputFormat)
	imagePath, err := fsio.SaveImage(result.ImageB64, filepath.Join(output, imageName))
	if err != nil {
		return err
	}
	absRaw, _ := filepath.Abs(rawPath)

	fmt.Printf("图片已保存:%s\n", imagePath)
	fmt.Printf("原始返回已保存:%s\n", absRaw)
	if result.RevisedPrompt != "" {
		fmt.Printf("修订提示词:%s\n", result.RevisedPrompt)
	}
	return nil
}

type multiFlag []string

func (m *multiFlag) String() string {
	return strings.Join(*m, ",")
}

func (m *multiFlag) Set(value string) error {
	*m = append(*m, value)
	return nil
}

func readPNGMask(rawPath string) (string, string, error) {
	maskPath, err := client.NormalizePath(rawPath)
	if err != nil {
		return "", "", err
	}
	raw, err := os.ReadFile(maskPath)
	if err != nil {
		return "", "", fmt.Errorf("读取蒙版失败: %w", err)
	}
	if _, err := png.DecodeConfig(bytes.NewReader(raw)); err != nil {
		return "", "", fmt.Errorf("--mask 必须是有效的 PNG 图片: %w", err)
	}
	return base64.StdEncoding.EncodeToString(raw), maskPath, nil
}

func fillFromEnv(target *string, key string) {
	if strings.TrimSpace(*target) != "" {
		return
	}
	if value := os.Getenv(key); strings.TrimSpace(value) != "" {
		*target = value
	}
}

func parseAPIMode(value string) (client.APIMode, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "responses":
		return client.APIModeResponses, nil
	case "images":
		return client.APIModeImages, nil
	default:
		return "", fmt.Errorf("--api-mode 必须是 responses 或 images")
	}
}

func parseResponsesTransport(value string) (client.ResponsesTransport, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "sse":
		return client.ResponsesTransportSSE, nil
	case "websocket":
		return client.ResponsesTransportWebSocket, nil
	default:
		return "", fmt.Errorf("--responses-transport 必须是 sse 或 websocket")
	}
}

func parseRequestPolicy(value string) (client.RequestPolicy, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "openai":
		return client.RequestPolicyOpenAI, nil
	case "compat":
		return client.RequestPolicyCompat, nil
	default:
		return "", fmt.Errorf("--request-policy 必须是 openai 或 compat")
	}
}
