package client

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsRetryableCloudflare524(t *testing.T) {
	html, err := os.ReadFile(filepath.Join("..", "..", "testdata", "cloudflare_524.html"))
	if err != nil {
		t.Fatal(err)
	}
	if !IsRetryable(string(html)) {
		t.Errorf("Cloudflare 524 HTML should be retryable")
	}
	if !strings.Contains(DescribeProblem(string(html)), "Cloudflare 524") {
		t.Errorf("DescribeProblem missing Cloudflare 524 marker: %q", DescribeProblem(string(html)))
	}
}

func TestIsRetryableJSON504(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "testdata", "json_504.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !IsRetryable(string(body)) {
		t.Errorf("JSON 504 body should be retryable")
	}
	if !strings.Contains(DescribeProblem(string(body)), "504") {
		t.Errorf("DescribeProblem missing 504 marker: %q", DescribeProblem(string(body)))
	}
}

func TestIsRetryableJSON403(t *testing.T) {
	body := `{"error":{"message":"Upstream request failed","type":"upstream_error","upstreamStatus":403}}`
	if !IsRetryable(body) {
		t.Errorf("JSON upstream 403 body should be retryable")
	}
}

func TestIsRetryableFHLSyncWaitExpired(t *testing.T) {
	body := `{"error":{"code":"sync_wait_expired","message":"图片任务仍在running，同步等待超时，已停止后台继续处理；请重新提交任务 sync-edit-test","type":"sync_expired"}}`
	if !IsRetryable(body) {
		t.Errorf("FHL sync_wait_expired should be retryable")
	}
}

func TestIsRetryableFalseForSuccess(t *testing.T) {
	if IsRetryable(`{"status":200,"output":[]}`) {
		t.Errorf("200 success should not be retryable")
	}
}

func TestDescribeProblemEmpty(t *testing.T) {
	if DescribeProblem("") != "接口返回为空。" {
		t.Errorf("empty body description wrong")
	}
}

func TestDescribeProblemExtractsRefusalTextFromResponsesSSE(t *testing.T) {
	raw := strings.Join([]string{
		`data: {"type":"response.output_item.done","item":{"type":"message","status":"completed","content":[{"type":"output_text","text":"抱歉，这个请求包含成人裸露，我无法生成这类真实照片风格图片。"}]}}`,
		`data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"image_generation_call","status":"failed"}]}}`,
	}, "\n")
	if got := DescribeProblem(raw); got != "抱歉，这个请求包含成人裸露，我无法生成这类真实照片风格图片。" {
		t.Fatalf("DescribeProblem refusal text = %q", got)
	}
}
