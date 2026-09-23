package com.nusa.mobile;

import androidx.annotation.NonNull;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.Collections;
import java.util.List;

/** Native-only owner credential boundary. It intentionally has no key-export API. */
public final class NusaOwnerDeviceCredentialPackage implements ReactPackage {
  @NonNull @Override public List<NativeModule> createNativeModules(@NonNull ReactApplicationContext context) {
    return Collections.singletonList(new NusaOwnerDeviceCredentialModule(context));
  }
  @NonNull @Override public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext context) { return Collections.emptyList(); }
}
