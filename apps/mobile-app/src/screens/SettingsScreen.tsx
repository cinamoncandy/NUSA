import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api, ApiError } from "../api/client";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { getApiKey, getServerUrl, setApiKey, setServerUrl } from "../storage/settings";
import { colors } from "../theme/colors";

type ConnectionState = { readonly kind: "idle" | "testing" | "ok" | "error"; readonly message?: string };

export function SettingsScreen() {
  const [serverUrl, setServerUrlInput] = useState("");
  const [apiKey, setApiKeyInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>({ kind: "idle" });

  useEffect(() => {
    void (async () => {
      setServerUrlInput(await getServerUrl());
      setApiKeyInput(await getApiKey());
    })();
  }, []);

  const save = async () => {
    await setServerUrl(serverUrl);
    await setApiKey(apiKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const testConnection = async () => {
    setConnection({ kind: "testing" });
    await setServerUrl(serverUrl);
    await setApiKey(apiKey);
    try {
      await api.health();
      setConnection({ kind: "ok" });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "연결 실패";
      setConnection({ kind: "error", message });
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card title="서버 주소">
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrlInput}
          placeholder="http://192.168.0.10:4100"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.hint}>같은 Wi-Fi(LAN)의 DOKKAEBI 서버 주소를 입력하세요.</Text>
      </Card>

      <Card title="API 키 (선택)">
        <TextInput
          style={styles.input}
          value={apiKey}
          onChangeText={setApiKeyInput}
          placeholder="서버에 DOKKAEBI_API_KEY가 설정된 경우 입력"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <Text style={styles.hint}>서버가 인증을 요구하지 않으면 비워 두어도 됩니다.</Text>
      </Card>

      <Button label={saved ? "저장됨" : "저장"} onPress={() => void save()} />
      <View style={{ height: 8 }} />
      <Button label="연결 테스트" variant="muted" loading={connection.kind === "testing"} onPress={() => void testConnection()} />

      {connection.kind === "ok" && <Text style={styles.ok}>연결 성공</Text>}
      {connection.kind === "error" && <Text style={styles.error}>{connection.message}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.fg,
    padding: 12,
    fontSize: 15
  },
  hint: { color: colors.muted, fontSize: 12, marginTop: 8 },
  ok: { color: colors.success, marginTop: 12, textAlign: "center" },
  error: { color: colors.danger, marginTop: 12, textAlign: "center" }
});
