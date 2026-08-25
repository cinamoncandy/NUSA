package com.nusa.mobile;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;

/**
 * Dedicated read-only Upbit quotation transport for Android.
 *
 * React Native fetch() is intentionally bypassed here. Real Galaxy evidence showed repeated HTTP
 * 400 responses from Upbit while the same quotation URL succeeds outside React Native, even after
 * JS header changes and a global RN/OkHttp User-Agent interceptor. HttpsURLConnection gives this
 * public GET-only path an isolated native transport with a single explicit User-Agent and no
 * credential-bearing headers.
 */
public final class NusaUpbitPublicQuotationModule extends ReactContextBaseJavaModule {
  public static final String NAME = "NusaUpbitPublicQuotation";
  private static final String USER_AGENT = "nusa-mobile-native/1.0";
  private static final String TICKER_URL = "https://api.upbit.com/v1/ticker/all?quote_currencies=KRW";
  private static final String CANDLE_BASE_URL = "https://api.upbit.com/v1/candles/minutes/1";
  private static final Pattern MARKET = Pattern.compile("^KRW-[A-Z0-9]+$");
  private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(2);

  public NusaUpbitPublicQuotationModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void getTicker(double timeoutMs, Promise promise) {
    final int timeout;
    try {
      timeout = checkedTimeout(timeoutMs);
    } catch (IllegalArgumentException error) {
      promise.reject("NUSA_UPBIT_NATIVE_INVALID_ARGUMENT", error.getMessage(), error);
      return;
    }
    execute(TICKER_URL, timeout, promise);
  }

  @ReactMethod
  public void getCandles(String market, double countValue, double timeoutMs, Promise promise) {
    final String normalizedMarket;
    final int count;
    final int timeout;
    try {
      normalizedMarket = checkedMarket(market);
      count = checkedCount(countValue);
      timeout = checkedTimeout(timeoutMs);
    } catch (IllegalArgumentException error) {
      promise.reject("NUSA_UPBIT_NATIVE_INVALID_ARGUMENT", error.getMessage(), error);
      return;
    }
    execute(CANDLE_BASE_URL + "?market=" + normalizedMarket + "&count=" + count, timeout, promise);
  }

  private static void execute(String requestUrl, int timeoutMs, Promise promise) {
    EXECUTOR.execute(() -> {
      HttpsURLConnection connection = null;
      try {
        connection = (HttpsURLConnection) new URL(requestUrl).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(timeoutMs);
        connection.setReadTimeout(timeoutMs);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setDoInput(true);
        connection.setRequestProperty("User-Agent", USER_AGENT);
        connection.setRequestProperty("Accept", "application/json");

        final int status = connection.getResponseCode();
        final InputStream stream = status >= 200 && status < 400
            ? connection.getInputStream()
            : connection.getErrorStream();
        final String body = readBody(stream);

        WritableMap result = Arguments.createMap();
        result.putInt("status", status);
        result.putString("body", body);
        result.putString("requestUrl", requestUrl);
        result.putString("userAgent", USER_AGENT);
        String contentType = connection.getContentType();
        if (contentType == null) result.putNull("contentType");
        else result.putString("contentType", contentType);
        promise.resolve(result);
      } catch (Exception error) {
        promise.reject("NUSA_UPBIT_NATIVE_REQUEST_FAILED", "Native Upbit public quotation request failed.", error);
      } finally {
        if (connection != null) connection.disconnect();
      }
    });
  }

  private static String checkedMarket(String value) {
    String market = value == null ? "" : value.trim().toUpperCase();
    if (!MARKET.matcher(market).matches()) throw new IllegalArgumentException("Invalid Upbit market.");
    return market;
  }

  private static int checkedCount(double value) {
    int count = (int) value;
    if (!Double.isFinite(value) || value != count || count < 1 || count > 200) {
      throw new IllegalArgumentException("Upbit candle count is out of bounds.");
    }
    return count;
  }

  private static int checkedTimeout(double value) {
    int timeout = (int) value;
    if (!Double.isFinite(value) || value != timeout || timeout < 1 || timeout > 30_000) {
      throw new IllegalArgumentException("Upbit public quotation timeout is out of bounds.");
    }
    return timeout;
  }

  private static String readBody(InputStream stream) throws IOException {
    if (stream == null) return "";
    try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[8192];
      int read;
      while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
      return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }
  }
}
