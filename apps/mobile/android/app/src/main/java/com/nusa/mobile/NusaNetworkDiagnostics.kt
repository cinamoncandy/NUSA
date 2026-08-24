package com.nusa.mobile

import java.util.concurrent.atomic.AtomicReference

/**
 * The last outgoing OkHttp request NusaUserAgentInterceptor (MainApplication.kt) actually built,
 * captured after the interceptor has replaced the User-Agent header but before the request is
 * handed to the network. This is deliberately the only fact this holds: it never touches the
 * response, so it cannot consume a response body a JS caller still needs to read, and it never
 * records anything from request/response headers other than the three fields below -- there is
 * no path here that could leak a credential header even by accident.
 */
public data class NusaNetworkDiagnosticSnapshot(
  val requestUrl: String,
  val method: String,
  val userAgent: String?,
  val capturedAtEpochMs: Long
)

public object NusaNetworkDiagnostics {
  private val last = AtomicReference<NusaNetworkDiagnosticSnapshot?>(null)

  @JvmStatic
  public fun record(requestUrl: String, method: String, userAgent: String?) {
    last.set(NusaNetworkDiagnosticSnapshot(requestUrl, method, userAgent, System.currentTimeMillis()))
  }

  @JvmStatic
  public fun snapshot(): NusaNetworkDiagnosticSnapshot? = last.get()
}
