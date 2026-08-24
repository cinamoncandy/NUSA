package com.nusa.mobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Upbit's public REST API has, at different times, rejected both (a) OkHttp's generic default
 * User-Agent and (b) a duplicated User-Agent header, each with HTTP 400 -- observed live on a
 * real Android device even after two prior JS-only fixes in upbitPublicQuotationClient.ts
 * (bd51b4a5 added a custom "user-agent" fetch header; 5bc750f2 later removed it again because
 * Upbit was rejecting the duplicate that produced).
 *
 * The JS-level header never reliably resolves this: React Native's Android networking bridge
 * does not guarantee a fetch() header replaces OkHttp's own default rather than being sent
 * alongside it, so neither "add a header" nor "don't add a header" from JS can, by itself,
 * guarantee exactly one non-default User-Agent reaches the wire. `Request.Builder.header(name,
 * value)` (unlike `.addHeader`) always replaces every prior value for that name, so applying it
 * here -- after RN's bridge has already built the request -- is the one place that can guarantee
 * a single, non-generic User-Agent regardless of what any JS caller does or does not set.
 */
private class NusaUserAgentInterceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request().newBuilder()
      .header("User-Agent", "nusa-mobile/0.1")
      .build()
    return chain.proceed(request)
  }
}

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(NusaSecureStoragePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Must run before React Native's own bootstrap call below: the client this replaces is
    // the one RN's networking module hands every fetch()/XHR call to, and only requests made
    // after this point pick up the replacement.
    OkHttpClientProvider.setOkHttpClient(
      OkHttpClientProvider.createClient().newBuilder()
        .addInterceptor(NusaUserAgentInterceptor())
        .build()
    )
    loadReactNative(this)
  }
}
