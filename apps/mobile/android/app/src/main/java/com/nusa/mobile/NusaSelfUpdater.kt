package com.nusa.mobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Verified updater for the privately distributed NUSA Android APK.
 *
 * Android does not allow a normal third-party app to silently replace itself. This updater
 * therefore automates discovery, download and SHA-256 verification, then opens the OS-managed
 * install UI. On Android 8+ the user may need to grant "install unknown apps" once for NUSA.
 */
object NusaSelfUpdater {
  private const val RELEASE_API = "https://api.github.com/repos/cinamoncandy/NUSA/releases/tags/nusa-android"
  private const val APK_URL = "https://github.com/cinamoncandy/NUSA/releases/download/nusa-android/NUSA-Android.apk"
  private const val SHA_URL = "https://github.com/cinamoncandy/NUSA/releases/download/nusa-android/NUSA-Android.apk.sha256"
  private const val CHECK_INTERVAL_MS = 10 * 60 * 1000L
  private const val MAX_APK_BYTES = 150L * 1024L * 1024L
  private const val CONNECT_TIMEOUT_MS = 15_000
  private const val READ_TIMEOUT_MS = 60_000
  private val checking = AtomicBoolean(false)

  fun checkFrom(activity: MainActivity) {
    if (!checking.compareAndSet(false, true)) return
    val prefs = activity.getSharedPreferences("nusa-self-update", Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val last = prefs.getLong("last-check-at", 0L)
    if (now - last < CHECK_INTERVAL_MS) {
      checking.set(false)
      return
    }

    Thread {
      try {
        val release = JSONObject(readUtf8(RELEASE_API, 1024 * 1024))
        val target = release.optString("target_commitish")
        val name = release.optString("name")
        if (!target.matches(Regex("^[0-9a-f]{40}$"))) return@Thread
        val remoteVersion = Regex("^NUSA Android 1\\.0\\.(\\d+)$").matchEntire(name)?.groupValues?.get(1)?.toLongOrNull()
          ?: return@Thread
        val currentVersion = if (Build.VERSION.SDK_INT >= 28) {
          activity.packageManager.getPackageInfo(activity.packageName, 0).longVersionCode
        } else {
          @Suppress("DEPRECATION")
          activity.packageManager.getPackageInfo(activity.packageName, 0).versionCode.toLong()
        }
        if (remoteVersion <= currentVersion) {
          prefs.edit().putLong("last-check-at", now).apply()
          return@Thread
        }

        val expectedSha = readUtf8(SHA_URL, 1024).trim().split(Regex("\\s+"))[0].lowercase()
        if (!expectedSha.matches(Regex("^[0-9a-f]{64}$"))) return@Thread

        val updateDir = File(activity.cacheDir, "updates").apply { mkdirs() }
        val apk = File(updateDir, "NUSA-Android-$remoteVersion.apk")
        download(APK_URL, apk)
        if (sha256(apk) != expectedSha) {
          apk.delete()
          return@Thread
        }

        activity.runOnUiThread {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            // Do not advance the throttle here. Returning from Settings must immediately retry
            // the verified release flow and continue into the OS installer.
            val permissionIntent = Intent(
              Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
              Uri.parse("package:${activity.packageName}")
            )
            activity.startActivity(permissionIntent)
            return@runOnUiThread
          }
          prefs.edit().putLong("last-check-at", now).apply()
          launchInstaller(activity, apk)
        }
      } catch (_: Exception) {
        // Fail closed: any network, metadata, checksum or installer preparation problem leaves the
        // currently installed build untouched and will be retried on a later foreground check.
      } finally {
        checking.set(false)
      }
    }.apply { name = "nusa-self-updater"; isDaemon = true }.start()
  }

  private fun launchInstaller(activity: MainActivity, apk: File) {
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", apk)
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    activity.startActivity(intent)
  }

  private fun readUtf8(url: String, maxBytes: Int): String {
    val connection = open(url)
    connection.inputStream.use { input ->
      val output = ByteArrayOutputStream()
      val buffer = ByteArray(4096)
      var total = 0
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        total += count
        require(total <= maxBytes)
        output.write(buffer, 0, count)
      }
      return output.toString(Charsets.UTF_8.name())
    }
  }

  private fun download(url: String, destination: File) {
    val connection = open(url)
    val contentLength = connection.contentLengthLong
    if (contentLength > 0) require(contentLength <= MAX_APK_BYTES)
    destination.outputStream().use { output ->
      connection.inputStream.use { input ->
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          total += count
          require(total <= MAX_APK_BYTES)
          output.write(buffer, 0, count)
        }
        require(total > 0)
      }
    }
  }

  private fun open(url: String): HttpURLConnection {
    require(url.startsWith("https://"))
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.instanceFollowRedirects = true
    connection.connectTimeout = CONNECT_TIMEOUT_MS
    connection.readTimeout = READ_TIMEOUT_MS
    connection.setRequestProperty("User-Agent", "nusa-android-self-updater/1")
    connection.connect()
    require(connection.responseCode in 200..299)
    require(connection.url.protocol == "https")
    return connection
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
