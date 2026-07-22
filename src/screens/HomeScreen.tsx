/**
 * HomeScreen — authenticated view.
 * Displays the user's email from GET /me, hosts the MediaShare feature,
 * and provides a sign-out button.
 * Requirements: 5.1–5.5, 6.1–6.3
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  SafeAreaView,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { authService } from '../auth/authService';
import { MediaShareScreen } from '../mediaShare/MediaShareScreen';
import type { UserProfile } from '../auth/types';

export function HomeScreen(): React.JSX.Element {
  const { logout } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  const fetchProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(false);
    try {
      const me = await authService.getMe();
      if (me !== null) {
        setProfile(me);
      }
      // If null, the 401 interceptor already called clearSession → AuthNavigator
      // will re-render to LoginScreen automatically — nothing to do here.
    } catch {
      setProfileError(true);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    await logout();
    // AuthNavigator re-renders automatically once authState → 'unauthenticated'.
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header bar */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Veeder</Text>
          {profileLoading ? (
            <ActivityIndicator size="small" color="#4f46e5" style={styles.profileSpinner} />
          ) : profileError ? (
            <View style={styles.profileErrorRow}>
              <Text style={styles.profileErrorText}>Could not load profile.</Text>
              <TouchableOpacity onPress={fetchProfile}>
                <Text style={styles.retryLink}> Retry</Text>
              </TouchableOpacity>
            </View>
          ) : profile ? (
            <Text style={styles.email}>{profile.email}</Text>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.signOutBtn, signingOut && styles.signOutBtnDisabled]}
          onPress={handleSignOut}
          disabled={signingOut}
          activeOpacity={0.7}
        >
          {signingOut
            ? <ActivityIndicator size="small" color="#4f46e5" />
            : <Text style={styles.signOutText}>Sign out</Text>}
        </TouchableOpacity>
      </View>

      {/* Media Share feature */}
      <View style={styles.mediaShareContainer}>
        <MediaShareScreen />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6fb' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e4e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#4f46e5', letterSpacing: 0.5 },
  profileSpinner: { marginTop: 4 },
  email: { fontSize: 13, color: '#475569', marginTop: 2 },
  profileErrorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  profileErrorText: { fontSize: 12, color: '#ef4444' },
  retryLink: { fontSize: 12, color: '#4f46e5', fontWeight: '600' },
  signOutBtn: {
    borderWidth: 1.5, borderColor: '#e4e8f0', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  signOutBtnDisabled: { opacity: 0.5 },
  signOutText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  mediaShareContainer: { flex: 1 },
});
