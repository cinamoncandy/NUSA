import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../theme/colors";

type Variant = "primary" | "danger" | "muted";

const BACKGROUND: Record<Variant, string> = {
  primary: colors.primary,
  danger: colors.danger,
  muted: colors.surfaceRaised
};

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: Variant;
  readonly loading?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: BACKGROUND[variant], opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }
      ]}
    >
      {loading ? <ActivityIndicator color={colors.fg} /> : <Text style={styles.label}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48
  },
  label: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15
  }
});
