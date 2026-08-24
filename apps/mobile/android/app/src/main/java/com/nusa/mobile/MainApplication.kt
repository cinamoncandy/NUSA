package com.nusa.mobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Keep a deterministic User-Agent on ordinary React Native HTTP traffic. Upbit public quotation
 * no longer depends on this path on Android: NusaUpbitPublicQuotationModule uses an isolated
 * HttpsURLConnection transport so repeated real-device HTTP 400s cannot be caused by RN/OkHttp
 * header composition.
 */
private class NusaUserAgentInterceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request().newBuilder()
      .header("User-Agent", "nusa-mobile/0.1")
      .build()
    NusaNetworkDiagnostics.record(request.url.toString(), request.method, request.header("User-Agent"))
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
          add(NusaNetworkDiagnosticsPackage())
          add(NusaUpbitPublicQuotationPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    OkHttpClientProvider.setOkHttpClientFactory {
      OkHttpClientProvider.createClientBuilder(this)
        .addInterceptor(NusaUserAgentInterceptor())
        .build()
    }
    loadReactNative(this)
  }
}
