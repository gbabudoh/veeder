/**
 * LoginScreen — authenticate with email + password.
 * Requirements: 2.1–2.8
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';

export interface LoginScreenProps {
  onGoToRegister: () => void;
}

export function LoginScreen({ onGoToRegister }: LoginScreenProps): React.JSX.Element {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [serverMessage, setServerMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(): Promise<void> {
    let valid = true;
    if (!email.trim()) { setEmailError('Email is required.'); valid = false; } else { setEmailError(''); }
    if (!password) { setPasswordError('Password is required.'); valid = false; } else { setPasswordError(''); }
    if (!valid) return;

    setServerMessage('');
    setLoading(true);

    const result = await login(email.trim(), password);

    setLoading(false);

    if (result.ok) {
      // AuthNavigator re-renders automatically when authState → 'authenticated'.
      return;
    }

    switch (result.reason) {
      case 'invalid_credentials':
        setServerMessage('Incorrect email or password.');
        break;
      case 'rate_limited':
        setServerMessage('Too many login attempts — please try again later.');
        break;
      case 'network_error':
        setServerMessage('Could not connect. Check your connection and try again.');
        break;
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.brand}>Veeder</Text>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to your account to continue.</Text>

          {serverMessage ? (
            <View style={styles.alertBox}>
              <Text style={styles.alertText}>{serverMessage}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, emailError ? styles.inputError : null]}
            placeholder="you@example.com"
            placeholderTextColor="#94a3b8"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          {emailError ? <Text style={styles.fieldError}>{emailError}</Text> : null}

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={[styles.input, passwordError ? styles.inputError : null]}
            placeholder="••••••••"
            placeholderTextColor="#94a3b8"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            editable={!loading}
          />
          {passwordError ? <Text style={styles.fieldError}>{passwordError}</Text> : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>Sign in</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={onGoToRegister} style={styles.linkRow}>
            <Text style={styles.linkText}>Don't have an account? <Text style={styles.link}>Register</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f4f6fb' },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 28, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  brand: { fontSize: 13, fontWeight: '700', color: '#4f46e5', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 24 },
  label: { fontSize: 12, fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  input: { backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 15, color: '#0f172a', marginBottom: 4 },
  inputError: { borderColor: '#ef4444' },
  fieldError: { fontSize: 12, color: '#ef4444', marginBottom: 12 },
  alertBox: { backgroundColor: '#fef2f2', borderRadius: 8, padding: 12, marginBottom: 18, borderWidth: 1, borderColor: '#fecaca' },
  alertText: { color: '#991b1b', fontSize: 13 },
  button: { backgroundColor: '#4f46e5', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 20 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  linkRow: { marginTop: 20, alignItems: 'center' },
  linkText: { fontSize: 13, color: '#64748b' },
  link: { color: '#4f46e5', fontWeight: '600' },
});
