import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

interface AppErrorBoundaryProps { readonly children: React.ReactNode; }
interface AppErrorBoundaryState { readonly hasError: boolean; readonly retryKey: number; }

function RecoveryScreen({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.screen} testID="app-error-fallback">
    <View style={styles.panel}>
      <Text style={styles.eyebrow}>NUSA RECOVERY</Text>
      <Text style={styles.title}>화면을 복구해야 합니다</Text>
      <Text style={styles.message}>예상하지 못한 화면 오류가 발생했습니다. 거래 권한이나 안전 설정은 변경되지 않았습니다. 다시 시도해 앱 화면을 새로 구성할 수 있습니다.</Text>
      <Pressable accessibilityLabel="앱 화면 다시 시도" accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} testID="app-error-retry">
        <Text style={styles.buttonLabel}>화면 다시 시도</Text>
      </Pressable>
      <Text style={styles.hint}>문제가 반복되면 앱을 완전히 종료한 뒤 다시 실행하세요. 오류 원문이나 자격 증명은 이 화면에 표시하지 않습니다.</Text>
    </View>
  </View>;
}

/** Last-resort render boundary. It intentionally has no network, credential, or trading authority. */
export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public state: AppErrorBoundaryState = { hasError: false, retryKey: 0 };

  public static getDerivedStateFromError(): Partial<AppErrorBoundaryState> { return { hasError: true }; }

  private readonly retry = (): void => {
    this.setState((current) => ({ hasError: false, retryKey: current.retryKey + 1 }));
  };

  public render(): React.ReactNode {
    if (this.state.hasError) return <RecoveryScreen onRetry={this.retry} />;
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", backgroundColor: "#041019", paddingHorizontal: 24, paddingTop: 48, paddingBottom: 32 },
  panel: { width: "100%", maxWidth: 640, alignSelf: "center", gap: 14, padding: 22, borderRadius: 16, borderWidth: 1, borderColor: "#153442", backgroundColor: "#091A26" },
  eyebrow: { color: "#49DEC9", fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: "#F5FBFD", fontSize: 24, lineHeight: 30, fontWeight: "800", letterSpacing: -0.7 },
  message: { color: "#8DA7B4", fontSize: 14, lineHeight: 21 },
  button: { minHeight: 48, borderRadius: 12, backgroundColor: "#49DEC9", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  buttonPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  buttonLabel: { color: "#041F1C", fontSize: 15, fontWeight: "800" },
  hint: { color: "#8DA7B4", fontSize: 12, lineHeight: 18 },
});
