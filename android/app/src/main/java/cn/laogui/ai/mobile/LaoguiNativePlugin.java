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
            values.put("fhlKey", safe(call.getString("fhlKey")));
            values.put("yybbKey", safe(call.getString("yybbKey")));
            values.put("aiwanwuKey", safe(call.getString("aiwanwuKey")));
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
    public void generateImage(PluginCall call) {
        new Thread(() -> {
            try {
                JSArray providers = call.getArray("providers", new JSArray());
                JSObject keys = call.getObject("keys", new JSObject());
                JSObject endpoints = call.getObject("endpoints", new JSObject());
                String model = safe(call.getString("model"));
                String prompt = safe(call.getString("prompt"));
                String requestId = safe(call.getString("requestId"));
                if (providers.length() == 0 || model.isEmpty() || prompt.isEmpty()) {
                    call.reject("手机版生图配置不完整，请重新安装最新版");
                    return;
                }

                Exception lastError = null;
                boolean hasKey = false;
                for (int index = 0; index < providers.length(); index++) {
                    JSONObject provider = providers.getJSONObject(index);
                    String providerId = safe(provider.optString("id"));
                    String apiKey = safe(keys.optString(providerId));
                    if (apiKey.isEmpty()) continue;
                    hasKey = true;
                    try {
                        List<String> images = requestProvider(call, provider, endpoints, model, prompt, requestId, apiKey);
                        JSObject result = new JSObject();
                        result.put("provider", providerId);
                        result.put("imageDataUrls", new JSArray(images));
                        call.resolve(result);
                        return;
                    } catch (AmbiguousRequestException error) {
                        JSObject data = new JSObject();
                        data.put("uncertain", true);
                        data.put("provider", providerId);
                        call.reject("网络中断，无法确认是否已经生成。为避免重复扣费，本任务不会自动重试。", "REQUEST_UNCERTAIN", error, data);
                        return;
                    } catch (Exception error) {
                        lastError = error;
                    }
                }
                if (!hasKey) {
                    call.reject("请至少填写一套API密钥");
                    return;
                }
                call.reject(lastError == null ? "三个生图接口均不可用" : lastError.getMessage(), lastError);
            } catch (Exception error) {
                call.reject("生图请求准备失败：" + safeMessage(error), error);
            }
        }, "laogui-image-request").start();
    }

    private List<String> requestProvider(
        PluginCall call,
        JSONObject provider,
        JSObject endpoints,
        String model,
        String prompt,
        String requestId,
        String apiKey
    ) throws Exception {
        JSArray inputImages = call.getArray("inputImages", new JSArray());
        String maskImage = safe(call.getString("maskImage"));
        boolean editing = inputImages.length() > 0 || !maskImage.isEmpty();
        String endpoint = editing ? endpoints.optString("edit") : endpoints.optString("generation");
        String baseUrl = safe(provider.optString("baseUrl")).replaceAll("/+$", "");
        if (endpoint.isEmpty() || baseUrl.isEmpty()) throw new IllegalArgumentException("接口配置缺少请求地址");
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
                    writeField(output, boundary, "quality", "medium");
                    writeField(output, boundary, "output_format", "png");
                    writeField(output, boundary, "stream", "false");
                    writeField(output, boundary, "n", String.valueOf(Math.max(1, Math.min(call.getInt("count", 1), 4))));
                    if (provider.optBoolean("imagesNewApiCompat", false)) writeField(output, boundary, "response_format", "b64_json");
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
                body.put("quality", "medium");
                body.put("output_format", "png");
                body.put("stream", false);
                body.put("n", Math.max(1, Math.min(call.getInt("count", 1), 4)));
                if (provider.optBoolean("imagesNewApiCompat", false)) body.put("response_format", "b64_json");
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
