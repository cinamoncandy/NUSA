package com.nusa.mobile;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

/**
 * Read-only bridge onto NusaNetworkDiagnostics.kt. This module has no write method: JS can only
 * ask "what did the native networking layer last actually send", never influence what gets
 * captured. The one fact it exposes -- URL, method, User-Agent -- is exactly what a real Galaxy
 * device diagnostic needs to tell a native OkHttp problem from a JS request-construction problem,
 * and nothing else the app's networking layer sees.
 */
public final class NusaNetworkDiagnosticsModule extends ReactContextBaseJavaModule {
  public static final String NAME = "NusaNetworkDiagnostics";

  public NusaNetworkDiagnosticsModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void getLastRequest(Promise promise) {
    NusaNetworkDiagnosticSnapshot snapshot = NusaNetworkDiagnostics.snapshot();
    if (snapshot == null) {
      promise.resolve(null);
      return;
    }
    WritableMap map = Arguments.createMap();
    map.putString("requestUrl", snapshot.getRequestUrl());
    map.putString("method", snapshot.getMethod());
    String userAgent = snapshot.getUserAgent();
    if (userAgent != null) {
      map.putString("userAgent", userAgent);
    } else {
      map.putNull("userAgent");
    }
    map.putDouble("capturedAtEpochMs", (double) snapshot.getCapturedAtEpochMs());
    promise.resolve(map);
  }
}
