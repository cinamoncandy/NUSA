import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { buttonTokens, cardTokens, fieldTokens, type ButtonTone } from "./designSystem";
import { useTheme } from "./ThemeProvider";

export interface NusaButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly tone?: ButtonTone;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export function NusaButton({ label, onPress, disabled = false, tone = "primary", accessibilityLabel, testID }: NusaButtonProps) {
  const { theme } = useTheme();
  const tokens = buttonTokens(theme, tone);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.button, { backgroundColor: tokens.background, borderRadius: tokens.radius, minHeight: tokens.minHeight, paddingHorizontal: tokens.horizontalPadding, opacity: disabled ? tokens.disabledOpacity : pressed ? 0.82 : 1 }]}
    >
      <Text style={[styles.buttonLabel, { color: tokens.foreground, fontWeight: theme.typography.weights.bold }]}>{label}</Text>
    </Pressable>
  );
}

export interface NusaTextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  readonly secureTextEntry?: boolean;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export function NusaTextField({ label, value, onChangeText, placeholder, secureTextEntry = false, accessibilityLabel, testID }: NusaTextFieldProps) {
  const { theme } = useTheme();
  const tokens = fieldTokens(theme);
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: theme.colors.textMuted, fontSize: theme.typography.caption }]}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.placeholder}
        secureTextEntry={secureTextEntry}
        style={[styles.field, { backgroundColor: tokens.background, borderColor: tokens.border, borderRadius: tokens.radius, color: tokens.foreground, minHeight: tokens.minHeight }]}
        testID={testID}
        value={value}
      />
    </View>
  );
}

export function NusaCard({ children, testID }: Readonly<{ children: React.ReactNode; testID?: string }>) {
  const { theme } = useTheme();
  const tokens = cardTokens(theme);
  return <View style={[styles.card, { backgroundColor: tokens.background, borderColor: tokens.border, borderRadius: tokens.radius, padding: tokens.padding, shadowColor: tokens.shadow.color, shadowOffset: tokens.shadow.offset, shadowOpacity: tokens.shadow.opacity, shadowRadius: tokens.shadow.radius, elevation: tokens.shadow.elevation }]} testID={testID}>{children}</View>;
}

const styles = StyleSheet.create({
  button: { alignItems: "center", justifyContent: "center" },
  buttonLabel: { fontSize: 16 },
  card: { borderWidth: 1 },
  field: { borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontWeight: "600" },
});
