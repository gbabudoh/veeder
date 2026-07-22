/**
 * AuthNavigator — conditional screen renderer driven by authState.
 *
 * Renders exactly ONE screen branch at a time — never HomeScreen + LoginScreen
 * simultaneously. Maintains local 'login'|'register' toggle for unauth screens.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from './AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { HomeScreen } from '../screens/HomeScreen';

type UnauthScreen = 'login' | 'register';

export function AuthNavigator(): React.JSX.Element {
  const { authState } = useAuth();
  const [unauthScreen, setUnauthScreen] = useState<UnauthScreen>('login');

  if (authState === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (authState === 'authenticated') {
    return <HomeScreen />;
  }

  // authState === 'unauthenticated'
  if (unauthScreen === 'register') {
    return (
      <RegisterScreen onGoToLogin={() => setUnauthScreen('login')} />
    );
  }

  return (
    <LoginScreen onGoToRegister={() => setUnauthScreen('register')} />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f6fb',
  },
});
