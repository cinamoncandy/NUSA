import type { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";

export function Card({ title, children }: PropsWithChildren<{ title?: string }>) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12
  },
  title: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5
  }
});
