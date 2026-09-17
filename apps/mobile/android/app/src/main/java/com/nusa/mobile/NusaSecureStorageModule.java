package com.nusa.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.Base64;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class NusaSecureStorageModule extends ReactContextBaseJavaModule {
  public static final String NAME = "NusaSecureStorage";
  private static final String KEY_ALIAS = "nusa_mobile_secure_storage_v1";
  private static final String PAPER_SESSION_KEY_ALIAS = "nusa_mobile_paper_session_v2";
  private static final String STORE_NAME = "nusa_secure_storage_v1";
  private static final String PAPER_SESSION_STORAGE_KEY = "nusa.mobile.approved-session.v2";
  private static final int PAPER_SESSION_AUTH_VALIDITY_SECONDS = 30 * 24 * 60 * 60;
  private static final String TRANSFORMATION = "AES/GCM/NoPadding";
  private static final int GCM_TAG_BITS = 128;
  private static final int MAX_KEY_LENGTH = 160;
  private static final int MAX_SECRET_BYTES = 16 * 1024;

  private final SharedPreferences preferences;

  public NusaSecureStorageModule(ReactApplicationContext reactContext) {
    super(reactContext);
    preferences = reactContext.getSharedPreferences(STORE_NAME, Context.MODE_PRIVATE);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void setSecret(String key, String valueBase64, Promise promise) {
    try {
      String normalizedKey = normalizeKey(key);
      byte[] plaintext = decodeSecret(valueBase64);
      SecretKey secretKey = getOrCreateKey(normalizedKey);
      Cipher cipher = Cipher.getInstance(TRANSFORMATION);
      cipher.init(Cipher.ENCRYPT_MODE, secretKey, new SecureRandom());
      cipher.updateAAD(normalizedKey.getBytes(StandardCharsets.UTF_8));
      byte[] ciphertext = cipher.doFinal(plaintext);
      String payload = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)
        + "."
        + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
      if (!preferences.edit().putString(normalizedKey, payload).commit()) {
        throw new IllegalStateException("secure storage write failed");
      }
      promise.resolve(null);
    } catch (UserNotAuthenticatedException error) {
      promise.reject("E_NUSA_SECURE_STORAGE_AUTH_REQUIRED", "device authentication is required", error);
    } catch (Exception error) {
      promise.reject("E_NUSA_SECURE_STORAGE_WRITE", "secure storage write failed", error);
    }
  }

  @ReactMethod
  public void getSecret(String key, Promise promise) {
    String normalizedKey;
    try {
      normalizedKey = normalizeKey(key);
    } catch (Exception error) {
      promise.reject("E_NUSA_SECURE_STORAGE_READ", "secure storage read failed", error);
      return;
    }
    String payload = preferences.getString(normalizedKey, null);
    if (payload == null) {
      promise.resolve(null);
      return;
    }
    try {
      int separator = payload.indexOf('.');
      if (separator <= 0 || separator == payload.length() - 1) {
        throw new IllegalStateException("secure storage payload invalid");
      }
      byte[] iv = Base64.decode(payload.substring(0, separator), Base64.NO_WRAP);
      byte[] ciphertext = Base64.decode(payload.substring(separator + 1), Base64.NO_WRAP);
      SecretKey secretKey = getOrCreateKey(normalizedKey);
      Cipher cipher = Cipher.getInstance(TRANSFORMATION);
      cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
      cipher.updateAAD(normalizedKey.getBytes(StandardCharsets.UTF_8));
      byte[] plaintext = cipher.doFinal(ciphertext);
      promise.resolve(Base64.encodeToString(plaintext, Base64.NO_WRAP));
    } catch (UserNotAuthenticatedException error) {
      // This is not corruption or expiry: retain the encrypted session until the
      // owner unlocks the already-approved device with Android biometrics/PIN.
      promise.reject("E_NUSA_SECURE_STORAGE_AUTH_REQUIRED", "device authentication is required", error);
    } catch (Exception error) {
      preferences.edit().remove(normalizedKey).commit();
      promise.reject("E_NUSA_SECURE_STORAGE_CORRUPTED", "secure storage payload could not be authenticated", error);
    }
  }

  @ReactMethod
  public void deleteSecret(String key, Promise promise) {
    try {
      String normalizedKey = normalizeKey(key);
      if (!preferences.edit().remove(normalizedKey).commit()) {
        throw new IllegalStateException("secure storage delete failed");
      }
      promise.resolve(null);
    } catch (Exception error) {
      promise.reject("E_NUSA_SECURE_STORAGE_DELETE", "secure storage delete failed", error);
    }
  }

  private static String normalizeKey(String key) {
    if (key == null) throw new IllegalArgumentException("secure storage key is required");
    String normalized = key.trim();
    if (normalized.isEmpty() || normalized.length() > MAX_KEY_LENGTH || !normalized.matches("[A-Za-z0-9._:-]+")) {
      throw new IllegalArgumentException("secure storage key is invalid");
    }
    return normalized;
  }

  private static byte[] decodeSecret(String valueBase64) {
    if (valueBase64 == null || valueBase64.isEmpty()) throw new IllegalArgumentException("secure storage value is required");
    byte[] value = Base64.decode(valueBase64, Base64.NO_WRAP);
    if (value.length == 0 || value.length > MAX_SECRET_BYTES) throw new IllegalArgumentException("secure storage value is invalid");
    return value;
  }

  private static SecretKey getOrCreateKey(String storageKey) throws Exception {
    final String alias = PAPER_SESSION_STORAGE_KEY.equals(storageKey) ? PAPER_SESSION_KEY_ALIAS : KEY_ALIAS;
    KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
    keyStore.load(null);
    java.security.Key existing = keyStore.getKey(alias, null);
    if (existing instanceof SecretKey) return (SecretKey) existing;

    KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256);
    if (PAPER_SESSION_STORAGE_KEY.equals(storageKey)) {
      // Android's system credential (strong biometric or lock-screen PIN) unlocks
      // this key. It is device-local, expires after a bounded interval, and never
      // adds Cloud, Upbit, or LIVE authority.
      builder.setUserAuthenticationRequired(true)
        .setUserAuthenticationValidityDurationSeconds(PAPER_SESSION_AUTH_VALIDITY_SECONDS);
    }
    generator.init(builder.build());
    return generator.generateKey();
  }
}
