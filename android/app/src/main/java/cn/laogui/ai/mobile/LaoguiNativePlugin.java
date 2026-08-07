package cn.laogui.ai.mobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.MediaStore;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;

import android.graphics.Color;
import android.view.View;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "LaoguiNative")
public class LaoguiNativePlugin extends Plugin {
    private static final String KEY_ALIAS = "laogui-mobile-api-secrets";
    private static final String PREFS_NAME = "laogui-secure-settings";
    private static final String PREF_VALUE = "encrypted-settings";

    @PluginMethod
    public void saveSecrets(PluginCall call) {
        try {
            JSONObject values = new JSONObject();
            values.put("profilesJson", safe(call.getString("profilesJson")));
            values.put("theme", safe(call.getString("theme")));
            String encrypted = encrypt(values.toString());
            preferences().edit().putString(PREF_VALUE, encrypted).apply();
            JSObject result = new JSObject();
            result.put("saved", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("API密钥加密保存失败", error);
        }
    }

    @PluginMethod
    public void setSystemBars(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            boolean light = "light".equals(call.getString("theme"));
            int color = light ? Color.rgb(238, 242, 246) : Color.rgb(11, 13, 19);
            getActivity().getWindow().setStatusBarColor(color);
            getActivity().getWindow().setNavigationBarColor(color);
            View decorView = getActivity().getWindow().getDecorView();
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getActivity().getWindow(), decorView);
            controller.setAppearanceLightStatusBars(light);
            controller.setAppearanceLightNavigationBars(light);
            call.resolve();
        });
    }

    @PluginMethod
    public void generateImage(PluginCall call) {
        new Thread(() -> {
            try {
                JSArray profiles = call.getArray("profiles", new JSArray());
                String prompt = safe(call.getString("prompt"));
                String requestId = safe(call.getString("requestId"));
                if (profiles.length() == 0 || prompt.isEmpty()) {
                    call.reject("请先导入包含接口地址、API Key 和模型的完整配置");
                    return;
                }

                Exception lastError = null;
                boolean hasEnabledProfile = false;
                for (int index = 0; index < profiles.length(); index++) {
                    JSONObject profile = profiles.getJSONObject(index);
                    if (!profile.optBoolean("enabled", true)) continue;
                    String apiKey = safe(profile.optString("apiKey"));
                    String model = safe(profile.optString("model"));
                    if (apiKey.isEmpty() || model.isEmpty()) continue;
                    hasEnabledProfile = true;
                    try {
                        List<String> images = requestProvider(call, profile, prompt, requestId, apiKey);
                        JSObject result = new JSObject();
                        result.put("provider", safe(profile.optString("label")));
                        result.put("imageDataUrls", new JSArray(images));
                        result.put("actualResolution", safe(call.getString("resolution")));
                        result.put("actualQuality", safe(call.getString("quality")));
                        call.resolve(result);
                        return;
                    } catch (AmbiguousRequestException error) {
                        JSObject data = new JSObject();
                        data.put("uncertain", true);
                        data.put("provider", safe(profile.optString("label")));
                        call.reject("网络中断，无法确认是否已经生成。为避免重复扣费，本任务不会自动重试。", "REQUEST_UNCERTAIN", error, data);
                        return;
                    } catch (Exception error) {
                        lastError = error;
                    }
                }
                if (!hasEnabledProfile) {
                    call.reject("没有可用的接口，请检查接口是否启用，并填写模型名称");
                    return;
                }
                call.reject(lastError == null ? "所有生图接口均不可用" : lastError.getMessage(), lastError);
            } catch (Exception error) {
                call.reject("生图请求准备失败：" + safeMessage(error), error);
            }
        }, "laogui-image-request").start();
    }

    @PluginMethod
    public void continueDesignConversation(PluginCall call) {
        new Thread(() -> {
            try {
                JSArray profiles = call.getArray("profiles", new JSArray());
                JSArray messages = call.getArray("messages", new JSArray());
                JSObject tool = call.getObject("tool", new JSObject());
                JSObject imageSummary = call.getObject("imageSummary", new JSObject());
                Exception lastError = null;
                boolean hasTextProfile = false;
                for (int index = 0; index < profiles.length(); index++) {
                    JSONObject profile = profiles.getJSONObject(index);
                    if (!profile.optBoolean("enabled", true)) continue;
                    String textModel = safe(profile.optString("textModel"));
                    String apiKey = safe(profile.optString("apiKey"));
                    String baseUrl = safe(profile.optString("baseUrl")).replaceAll("/+$", "");
                    if (textModel.isEmpty() || apiKey.isEmpty() || baseUrl.isEmpty()) continue;
                    hasTextProfile = true;
                    try {
                        JSONObject reply = requestTextConversation(profile, apiKey, textModel, tool, imageSummary, messages);
                        JSObject result = new JSObject();
                        result.put("reply", reply.optString("reply", "请继续补充设计要求。"));
                        result.put("ready", reply.optBoolean("ready", false));
                        result.put("summary", reply.optString("summary", ""));
                        result.put("finalPrompt", reply.optString("finalPrompt", ""));
                        result.put("provider", safe(profile.optString("label")));
                        call.resolve(result);
                        return;
                    } catch (Exception error) {
                        lastError = error;
                    }
                }
                if (!hasTextProfile) {
                    call.reject("没有配置文字模型，将使用本机规则整理");
                    return;
                }
                call.reject(lastError == null ? "文字对话接口不可用" : safeMessage(lastError), lastError);
            } catch (Exception error) {
                call.reject("文字对话准备失败：" + safeMessage(error), error);
            }
        }, "laogui-text-conversation").start();
    }

    private JSONObject requestTextConversation(
        JSONObject profile,
        String apiKey,
        String textModel,
        JSObject tool,
        JSObject imageSummary,
        JSArray messages
    ) throws Exception {
        String endpoint = safe(profile.optString("responsesPath", "/v1/responses"));
        if (!endpoint.startsWith("/")) endpoint = "/" + endpoint;
        String baseUrl = safe(profile.optString("baseUrl")).replaceAll("/+$", "");
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(90_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Authorization", "Bearer " + apiKey);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");
        try {
            StringBuilder transcript = new StringBuilder();
            transcript.append("当前设计能力：").append(tool.optString("name", "未命名能力")).append("\n");
            transcript.append("能力说明：").append(tool.optString("prompt", "")).append("\n");
            transcript.append("图片关系：").append(imageSummary.toString()).append("\n\n对话历史：\n");
            for (int index = 0; index < messages.length(); index++) {
                JSONObject message = messages.getJSONObject(index);
                transcript.append("user".equals(message.optString("role")) ? "用户：" : "助手：")
                    .append(message.optString("content", "")).append("\n");
            }
            JSONObject body = new JSONObject();
            body.put("model", textModel);
            body.put("instructions", "你是建筑与室内设计需求整理助手。每轮最多提出一个必要问题。信息足够时整理方案，但绝不能声称已经生成图片。只返回JSON对象，字段必须是reply、ready、summary、finalPrompt；ready必须是布尔值。reply用简短中文，summary和finalPrompt在信息不足时为空字符串。");
            body.put("input", transcript.toString());
            body.put("max_output_tokens", 900);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
                output.flush();
            }
            int status = connection.getResponseCode();
            byte[] bytes = readAll(status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream());
            if (status < 200 || status >= 300) throw new ProviderRejectedException(providerError(status, new String(bytes, StandardCharsets.UTF_8)));
            JSONObject response = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            String text = collectResponseText(response);
            int start = text.indexOf('{');
            int end = text.lastIndexOf('}');
            if (start < 0 || end <= start) throw new IllegalStateException("文字接口没有返回可识别的方案");
            return new JSONObject(text.substring(start, end + 1));
        } finally {
            connection.disconnect();
        }
    }

    private String collectResponseText(Object value) {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            for (String key : new String[] { "output_text", "text" }) {
                Object direct = object.opt(key);
                if (direct instanceof String && !safe((String) direct).isEmpty()) return (String) direct;
            }
            for (String key : new String[] { "output", "content", "message", "choices" }) {
                String nested = collectResponseText(object.opt(key));
                if (!nested.isEmpty()) return nested;
            }
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int index = 0; index < array.length(); index++) {
                String nested = collectResponseText(array.opt(index));
                if (!nested.isEmpty()) return nested;
            }
        }
        return "";
    }

    private List<String> requestProvider(
        PluginCall call,
        JSONObject profile,
        String prompt,
        String requestId,
        String apiKey
    ) throws Exception {
        JSArray inputImages = call.getArray("inputImages", new JSArray());
        String maskImage = safe(call.getString("maskImage"));
        boolean editing = inputImages.length() > 0 || !maskImage.isEmpty();
        String endpoint = editing ? safe(profile.optString("editPath")) : safe(profile.optString("generationPath"));
        String baseUrl = safe(profile.optString("baseUrl")).replaceAll("/+$", "");
        String model = safe(profile.optString("model"));
        if (endpoint.isEmpty() || baseUrl.isEmpty()) throw new IllegalArgumentException("接口配置缺少请求地址");
        if (!endpoint.startsWith("/")) endpoint = "/" + endpoint;
        URL url = new URL(baseUrl + endpoint);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(300_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Authorization", "Bearer " + apiKey);
        connection.setRequestProperty("Accept", "application/json");
        if (!requestId.isEmpty()) {
            connection.setRequestProperty("Idempotency-Key", requestId);
            connection.setRequestProperty("X-Request-ID", requestId);
        }

        boolean bodySent = false;
        try {
            if (editing) {
                String boundary = "LaoguiAI-" + UUID.randomUUID();
                connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                try (DataOutputStream output = new DataOutputStream(connection.getOutputStream())) {
                    bodySent = true;
                    writeField(output, boundary, "model", model);
                    writeField(output, boundary, "prompt", prompt);
                    writeField(output, boundary, "size", safe(call.getString("size")));
                    writeField(output, boundary, "quality", safe(call.getString("quality")).isEmpty() ? "medium" : safe(call.getString("quality")));
                    writeField(output, boundary, "output_format", "png");
                    writeField(output, boundary, "stream", "false");
                    writeField(output, boundary, "n", String.valueOf(Math.max(1, Math.min(call.getInt("count", 1), 4))));
                    if (profile.optBoolean("imagesNewApiCompat", false)) writeField(output, boundary, "response_format", "b64_json");
                    for (int index = 0; index < Math.min(inputImages.length(), 9); index++) {
                        writeImage(output, boundary, "image", "input-" + (index + 1), inputImages.getString(index));
                    }
                    if (!maskImage.isEmpty()) writeImage(output, boundary, "mask", "mask", maskImage);
                    output.writeBytes("--" + boundary + "--\r\n");
                    output.flush();
                }
            } else {
                JSONObject body = new JSONObject();
                body.put("model", model);
                body.put("prompt", prompt);
                body.put("size", safe(call.getString("size")));
                body.put("quality", safe(call.getString("quality")).isEmpty() ? "medium" : safe(call.getString("quality")));
                body.put("output_format", "png");
                body.put("stream", false);
                body.put("n", Math.max(1, Math.min(call.getInt("count", 1), 4)));
                if (profile.optBoolean("imagesNewApiCompat", false)) body.put("response_format", "b64_json");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream output = connection.getOutputStream()) {
                    bodySent = true;
                    output.write(body.toString().getBytes(StandardCharsets.UTF_8));
                    output.flush();
                }
            }
            int status = connection.getResponseCode();
            byte[] bytes = readAll(status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream());
            if (status < 200 || status >= 300) {
                String message = new String(bytes, StandardCharsets.UTF_8);
                throw new ProviderRejectedException(providerError(status, message));
            }
            String contentType = safe(connection.getContentType()).toLowerCase();
            if (contentType.startsWith("image/")) {
                List<String> direct = new ArrayList<>();
                direct.add("data:" + contentType.split(";", 2)[0] + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
                return direct;
            }
            List<String> images = new ArrayList<>();
            collectImages(new JSONObject(new String(bytes, StandardCharsets.UTF_8)), images);
            if (images.isEmpty()) throw new IllegalStateException("接口返回成功，但没有找到图片结果");
            return images;
        } catch (ProviderRejectedException error) {
            throw error;
        } catch (Exception error) {
            if (bodySent) throw new AmbiguousRequestException(error);
            throw error;
        } finally {
            connection.disconnect();
        }
    }

    @PluginMethod
    public void testApiProfile(PluginCall call) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                String baseUrl = safe(call.getString("baseUrl")).replaceAll("/+$", "");
                String apiKey = safe(call.getString("apiKey"));
                if (baseUrl.isEmpty() || apiKey.isEmpty()) throw new IllegalArgumentException("接口地址或 API Key 为空");
                connection = (HttpURLConnection) new URL(baseUrl + "/v1/models").openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(20_000);
                connection.setReadTimeout(30_000);
                connection.setRequestProperty("Authorization", "Bearer " + apiKey);
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException(providerError(status, new String(readAll(connection.getErrorStream()), StandardCharsets.UTF_8)));
                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("连接测试失败：" + safeMessage(error), error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "laogui-api-test").start();
    }

    private void writeField(DataOutputStream output, String boundary, String name, String value) throws Exception {
        output.writeBytes("--" + boundary + "\r\n");
        output.writeBytes("Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n");
        output.write(value.getBytes(StandardCharsets.UTF_8));
        output.writeBytes("\r\n");
    }

    private void writeImage(DataOutputStream output, String boundary, String field, String fileName, String dataUrl) throws Exception {
        ImageData image = decodeImage(dataUrl);
        output.writeBytes("--" + boundary + "\r\n");
        output.writeBytes("Content-Disposition: form-data; name=\"" + field + "\"; filename=\"" + fileName + image.extension + "\"\r\n");
        output.writeBytes("Content-Type: " + image.mimeType + "\r\n\r\n");
        output.write(image.bytes);
        output.writeBytes("\r\n");
    }

    private ImageData decodeImage(String dataUrl) {
        int comma = dataUrl.indexOf(',');
        int semicolon = dataUrl.indexOf(';');
        if (!dataUrl.startsWith("data:image/") || comma < 0 || semicolon < 5) throw new IllegalArgumentException("输入图片格式无效");
        String mimeType = dataUrl.substring(5, semicolon).toLowerCase();
        String extension = mimeType.contains("jpeg") ? ".jpg" : mimeType.contains("webp") ? ".webp" : ".png";
        return new ImageData(mimeType, extension, Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT));
    }

    private void collectImages(Object value, List<String> results) throws Exception {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            String base64 = safe(object.optString("b64_json"));
            if (!base64.isEmpty()) results.add(base64.startsWith("data:image/") ? base64 : "data:image/png;base64," + base64);
            String imageUrl = safe(object.optString("url"));
            if (!imageUrl.isEmpty()) results.add(imageUrl.startsWith("data:image/") ? imageUrl : downloadImage(imageUrl));
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (!"b64_json".equals(key) && !"url".equals(key)) collectImages(object.opt(key), results);
            }
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int index = 0; index < array.length(); index++) collectImages(array.opt(index), results);
        }
    }

    private String downloadImage(String imageUrl) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(imageUrl).openConnection();
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(120_000);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("生成结果图片下载失败（" + status + "）");
            String mimeType = safe(connection.getContentType()).split(";", 2)[0];
            if (!mimeType.startsWith("image/")) mimeType = "image/png";
            return "data:" + mimeType + ";base64," + Base64.encodeToString(readAll(connection.getInputStream()), Base64.NO_WRAP);
        } finally {
            connection.disconnect();
        }
    }

    private byte[] readAll(InputStream stream) throws Exception {
        if (stream == null) return new byte[0];
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
            return output.toByteArray();
        }
    }

    private String providerError(int status, String response) {
        String message = response;
        try {
            JSONObject json = new JSONObject(response);
            Object error = json.opt("error");
            if (error instanceof JSONObject) message = ((JSONObject) error).optString("message", response);
            else if (error != null) message = String.valueOf(error);
        } catch (Exception ignored) {}
        message = message.replaceAll("sk-[A-Za-z0-9_-]+", "<已隐藏密钥>").trim();
        if (message.length() > 240) message = message.substring(0, 240);
        return "接口返回错误（" + status + "）：" + (message.isEmpty() ? "未知原因" : message);
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? "未知错误" : message;
    }

    private static class ImageData {
        final String mimeType;
        final String extension;
        final byte[] bytes;

        ImageData(String mimeType, String extension, byte[] bytes) {
            this.mimeType = mimeType;
            this.extension = extension;
            this.bytes = bytes;
        }
    }

    private static class ProviderRejectedException extends Exception {
        ProviderRejectedException(String message) { super(message); }
    }

    private static class AmbiguousRequestException extends Exception {
        AmbiguousRequestException(Exception cause) { super(cause); }
    }

    @PluginMethod
    public void loadSecrets(PluginCall call) {
        try {
            String encrypted = preferences().getString(PREF_VALUE, "");
            JSObject result = new JSObject();
            if (encrypted.isEmpty()) {
                result.put("value", new JSObject());
                call.resolve(result);
                return;
            }
            JSONObject json = new JSONObject(decrypt(encrypted));
            JSObject value = new JSObject();
            Iterator<String> keys = json.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                value.put(key, json.optString(key, ""));
            }
            result.put("value", value);
            call.resolve(result);
        } catch (Exception error) {
            preferences().edit().remove(PREF_VALUE).apply();
            call.reject("API密钥读取失败，请重新填写", error);
        }
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        String dataUrl = safe(call.getString("dataUrl"));
        String projectName = sanitizePath(call.getString("projectName"), "未命名项目");
        String fileName = sanitizePath(call.getString("fileName"), "laogui-image.png");
        try {
            int comma = dataUrl.indexOf(',');
            if (comma < 0 || !dataUrl.startsWith("data:image/")) {
                call.reject("图片内容无效");
                return;
            }
            String mimeType = dataUrl.substring(5, dataUrl.indexOf(';'));
            byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
            values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/老鬼AI/" + projectName);
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            ContentResolver resolver = getContext().getContentResolver();
            Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("无法创建图片文件");
            try (OutputStream stream = resolver.openOutputStream(uri)) {
                if (stream == null) throw new IllegalStateException("无法写入图片文件");
                stream.write(bytes);
            } catch (Exception error) {
                resolver.delete(uri, null, null);
                throw error;
            }
            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            result.put("webPath", uri.toString());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("图片保存到老鬼AI文件夹失败", error);
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private SecretKey secretKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    private String encrypt(String plainText) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] encrypted = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private String decrypt(String value) throws Exception {
        String[] parts = value.split("\\.", 2);
        if (parts.length != 2) throw new IllegalArgumentException("加密内容损坏");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    private String sanitizePath(String value, String fallback) {
        String normalized = Normalizer.normalize(safe(value), Normalizer.Form.NFKC).replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "-").trim();
        return normalized.isEmpty() ? fallback : normalized.substring(0, Math.min(normalized.length(), 80));
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }
}
