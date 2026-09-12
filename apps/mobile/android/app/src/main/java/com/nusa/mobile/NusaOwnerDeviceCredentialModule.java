package com.nusa.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.UUID;

/**
 * A P-256 AndroidKeyStore credential for NUSA owner authentication. The private key remains
 * non-exportable in AndroidKeyStore: JavaScript can request a proof over server-provided bytes,
 * but it can never read or serialize the key material.
 */
public final class NusaOwnerDeviceCredentialModule extends ReactContextBaseJavaModule {
  public static final String NAME = "NusaOwnerDeviceCredential";
  private static final String STORE = "nusa_owner_device_credential_v1";
  private static final String ACTIVE_ID = "credential_id";
  private static final String ALIAS_PREFIX = "nusa_owner_device_credential_p256_";
  // A CryptoObject flow is biometric-only.
  private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG;
  private static final int MAX_CHALLENGE_BYTES = 4096;
  private final SharedPreferences preferences;

  public NusaOwnerDeviceCredentialModule(ReactApplicationContext context) {
    super(context);
    preferences = context.getSharedPreferences(STORE, Context.MODE_PRIVATE);
  }

  @NonNull @Override public String getName() { return NAME; }

  @ReactMethod public void getStatus(Promise promise) {
    WritableMap result = Arguments.createMap();
    String credentialId = preferences.getString(ACTIVE_ID, null);
    boolean apiSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
    int biometricStatus = apiSupported ? BiometricManager.from(getReactApplicationContext()).canAuthenticate(AUTHENTICATORS) : BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED;
    boolean keyPresent = credentialId != null && hasKey(credentialId);
    result.putBoolean("available", apiSupported && biometricStatus == BiometricManager.BIOMETRIC_SUCCESS && keyPresent && isHardwareBacked(credentialId));
    result.putBoolean("canCreate", apiSupported && biometricStatus == BiometricManager.BIOMETRIC_SUCCESS);
    result.putBoolean("hardwareBacked", keyPresent && isHardwareBacked(credentialId));
    result.putString("status", statusName(apiSupported, biometricStatus, keyPresent));
    if (keyPresent) result.putString("credentialId", credentialId); else result.putNull("credentialId");
    promise.resolve(result);
  }

  @ReactMethod public void createCredential(Promise promise) {
    try {
      requireSupportedAuthentication();
      String previous = preferences.getString(ACTIVE_ID, null);
      if (previous != null) deleteAlias(previous);
      String credentialId = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
      KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
      KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(alias(credentialId), KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .setUserAuthenticationRequired(true)
        .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        .build();
      generator.initialize(spec);
      generator.generateKeyPair();
      if (!isHardwareBacked(credentialId)) { deleteAlias(credentialId); throw new IllegalStateException("hardware-backed credential is unavailable"); }
      KeyStore keyStore = keyStore();
      byte[] spki = keyStore.getCertificate(alias(credentialId)).getPublicKey().getEncoded();
      if (!preferences.edit().putString(ACTIVE_ID, credentialId).commit()) throw new IllegalStateException("credential metadata write failed");
      WritableMap result = Arguments.createMap();
      result.putString("credentialId", credentialId);
      result.putString("publicKeySpki", Base64.encodeToString(spki, Base64.NO_WRAP));
      result.putBoolean("hardwareBacked", true);
      promise.resolve(result);
    } catch (Exception error) { promise.reject("E_NUSA_OWNER_DEVICE_CREDENTIAL_CREATE", "Unable to create a hardware-backed owner credential.", error); }
  }

  @ReactMethod public void signChallenge(String credentialId, String challengeBase64, String promptMessage, Promise promise) {
    try {
      requireSupportedAuthentication();
      String id = requireCredentialId(credentialId);
      byte[] challenge = Base64.decode(challengeBase64, Base64.NO_WRAP);
      if (challenge.length < 1 || challenge.length > MAX_CHALLENGE_BYTES || !Base64.encodeToString(challenge, Base64.NO_WRAP).equals(challengeBase64)) throw new IllegalArgumentException("challenge is invalid");
      KeyStore store = keyStore();
      PrivateKey privateKey = (PrivateKey) store.getKey(alias(id), null);
      if (privateKey == null || !isHardwareBacked(id)) throw new IllegalStateException("hardware-backed credential is unavailable");
      Signature signer = Signature.getInstance("SHA256withECDSA");
      signer.initSign(privateKey);
      FragmentActivity activity = getCurrentActivity() instanceof FragmentActivity ? (FragmentActivity) getCurrentActivity() : null;
      if (activity == null || activity.isFinishing()) throw new IllegalStateException("owner authentication activity is unavailable");
      String message = promptMessage == null ? "NUSA 소유자 인증" : promptMessage.trim();
      if (message.isEmpty() || message.length() > 120) message = "NUSA 소유자 인증";
      BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), new BiometricPrompt.AuthenticationCallback() {
        @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
          try {
            Signature authenticated = result.getCryptoObject() == null ? null : result.getCryptoObject().getSignature();
            if (authenticated == null) throw new IllegalStateException("authentication signature is unavailable");
            authenticated.update(challenge);
            promise.resolve(Base64.encodeToString(authenticated.sign(), Base64.NO_WRAP));
          } catch (Exception error) { promise.reject("E_NUSA_OWNER_DEVICE_CREDENTIAL_SIGN", "Owner authentication could not sign the challenge.", error); }
        }
        @Override public void onAuthenticationError(int code, @NonNull CharSequence error) { promise.reject("E_NUSA_OWNER_DEVICE_CREDENTIAL_AUTH", "Owner authentication was not completed."); }
      });
      BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder().setTitle("NUSA 소유자 인증").setSubtitle(message).setAllowedAuthenticators(AUTHENTICATORS).build();
      prompt.authenticate(info, new BiometricPrompt.CryptoObject(signer));
    } catch (Exception error) { promise.reject("E_NUSA_OWNER_DEVICE_CREDENTIAL_SIGN", "Owner authentication could not start.", error); }
  }

  @ReactMethod public void deleteCredential(String credentialId, Promise promise) {
    try {
      String id = requireCredentialId(credentialId);
      deleteAlias(id);
      if (id.equals(preferences.getString(ACTIVE_ID, null)) && !preferences.edit().remove(ACTIVE_ID).commit()) throw new IllegalStateException("credential metadata delete failed");
      promise.resolve(null);
    } catch (Exception error) { promise.reject("E_NUSA_OWNER_DEVICE_CREDENTIAL_DELETE", "Unable to delete owner credential.", error); }
  }

  private void requireSupportedAuthentication() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) throw new IllegalStateException("Android 11 or later is required for biometric signing");
    if (BiometricManager.from(getReactApplicationContext()).canAuthenticate(AUTHENTICATORS) != BiometricManager.BIOMETRIC_SUCCESS) throw new IllegalStateException("strong biometric is unavailable");
  }
  private static String requireCredentialId(String value) {
    String id = value == null ? "" : value.trim();
    if (!id.matches("^[A-Za-z0-9_-]{16,128}$")) throw new IllegalArgumentException("credential id is invalid");
    return id;
  }
  private static String alias(String id) { return ALIAS_PREFIX + requireCredentialId(id); }
  private static KeyStore keyStore() throws Exception { KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); return store; }
  private static boolean hasKey(String id) { try { return keyStore().containsAlias(alias(id)); } catch (Exception ignored) { return false; } }
  private static void deleteAlias(String id) throws Exception { keyStore().deleteEntry(alias(id)); }
  private static boolean isHardwareBacked(String id) {
    try {
      PrivateKey key = (PrivateKey) keyStore().getKey(alias(id), null);
      if (key == null) return false;
      KeyInfo info = KeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore").getKeySpec(key, KeyInfo.class);
      return info.isInsideSecureHardware();
    } catch (Exception ignored) { return false; }
  }
  private static String statusName(boolean apiSupported, int biometricStatus, boolean keyPresent) {
    if (!apiSupported) return "ANDROID_11_REQUIRED";
    if (biometricStatus != BiometricManager.BIOMETRIC_SUCCESS) return "AUTHENTICATOR_UNAVAILABLE";
    return keyPresent ? "CREDENTIAL_PRESENT" : "CREDENTIAL_NOT_REGISTERED";
  }
}
