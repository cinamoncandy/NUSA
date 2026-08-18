package com.nusa.mobile
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
class NusaSecureStorageModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val preferences = context.getSharedPreferences("nusa_secure_storage", Context.MODE_PRIVATE)
  private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  override fun getName(): String = "NusaSecureStorage"
  @ReactMethod fun setSecret(key: String, value: String, promise: Promise) = try { require(key.isNotBlank() && value.isNotEmpty()); val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(key)); val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP); val ciphertext = Base64.encodeToString(cipher.doFinal(Base64.decode(value, Base64.DEFAULT)), Base64.NO_WRAP); require(preferences.edit().putString(key, "$iv:$ciphertext").commit()); promise.resolve(null) } catch (_: Exception) { promise.reject("SECURE_STORAGE_UNAVAILABLE", "Secure storage operation failed") }
  @ReactMethod fun getSecret(key: String, promise: Promise) = try { val stored = preferences.getString(key, null) ?: return promise.resolve(null); val parts = stored.split(":", limit = 2); require(parts.size == 2); val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(key), GCMParameterSpec(128, Base64.decode(parts[0], Base64.DEFAULT))); promise.resolve(Base64.encodeToString(cipher.doFinal(Base64.decode(parts[1], Base64.DEFAULT)), Base64.NO_WRAP)) } catch (_: Exception) { promise.reject("SECURE_STORAGE_UNAVAILABLE", "Secure storage operation failed") }
  @ReactMethod fun deleteSecret(key: String, promise: Promise) = try { require(preferences.edit().remove(key).commit()); promise.resolve(null) } catch (_: Exception) { promise.reject("SECURE_STORAGE_UNAVAILABLE", "Secure storage operation failed") }
  private fun key(alias: String): java.security.Key { if (!keyStore.containsAlias(alias)) { val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"); generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setUserAuthenticationRequired(false).build()); generator.generateKey() }; return (keyStore.getEntry(alias, null) as KeyStore.SecretKeyEntry).secretKey }
}
