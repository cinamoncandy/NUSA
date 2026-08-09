import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { ActivityIndicator, View, Text, Alert } from "react-native";

import { DashboardScreen } from "./screens/DashboardScreen";
import { PortfolioScreen } from "./screens/PortfolioScreen";
import { ControlScreen } from "./screens/ControlScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { api, ApiError, NotConfiguredError } from "./api/client";
import { getServerUrl } from "./storage/settings";
import { colors } from "./theme/colors";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

/** 진입점: 연결 상태 확인 후 적절한 화면으로 라우팅 */
function RootNavigator() {
  const [initialized, setInitialized] = useState(false);
  const [serverConfigured, setServerConfigured] = useState(false);

  useEffect(() => {
    async function checkConfiguration() {
      try {
        const url = await getServerUrl();
        setServerConfigured(!!url);
      } catch {
        setServerConfigured(false);
      } finally {
        setInitialized(true);
      }
    }

    checkConfiguration();
  }, []);

  if (!initialized) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // 서버가 설정되지 않은 경우 Settings 화면으로 바로 이동
  if (!serverConfigured) {
    return (
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "bold" },
        }}
      >
        <Stack.Screen
          name="SettingsOnly"
          component={SettingsScreen}
          options={{ title: "서버 설정", headerShown: true }}
        />
      </Stack.Navigator>
    );
  }

  // 서버가 설정된 경우 탭 네비게이션
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "bold" },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: "대시보드",
          tabBarLabel: "대시보드",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📊</Text>,
        }}
      />
      <Tab.Screen
        name="Portfolio"
        component={PortfolioScreen}
        options={{
          title: "포트폴리오",
          tabBarLabel: "포트폴리오",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>💼</Text>,
        }}
      />
      <Tab.Screen
        name="Control"
        component={ControlScreen}
        options={{
          title: "제어",
          tabBarLabel: "제어",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⚙️</Text>,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: "설정",
          tabBarLabel: "설정",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⚙️</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <RootNavigator />
    </NavigationContainer>
  );
}
