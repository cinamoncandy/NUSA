package com.nusa.mobile

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

class NusaBuildConfigModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "NusaBuildConfig"

  override fun getConstants(): MutableMap<String, Any> = hashMapOf(
    "apiBaseUrl" to BuildConfig.NUSA_API_BASE_URL,
  )
}
