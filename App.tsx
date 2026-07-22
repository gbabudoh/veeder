/**
 * veeder App entry point.
 *
 * Wraps the app in AuthProvider + AuthNavigator.
 * AuthNavigator shows:
 *   - Loading spinner while reading persisted tokens
 *   - LoginScreen / RegisterScreen when unauthenticated
 *   - HomeScreen (which includes MediaShareScreen) when authenticated
 */

import React from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import { AuthNavigator } from './src/auth/AuthNavigator';

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AuthProvider>
        <AuthNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default App;
