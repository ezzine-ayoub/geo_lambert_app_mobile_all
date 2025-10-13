import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { router, useSegments, usePathname } from 'expo-router';
import { useUserAuth } from '../contexts/UserAuthContext';

interface AuthGuardProps {
  children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isAuthenticated, isLoading, error, clearError, sessionValid } = useUserAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const [hasRedirected, setHasRedirected] = useState(false);

  useEffect(() => {
    // Ne rien faire pendant le chargement initial
    if (isLoading) {
      return;
    }

    const inAuthGroup = segments[0] === '(tabs)';
    const isOnLoginPage = pathname === '/login' || segments.includes('login');

    // CAS 1: Erreur d'authentification -> Redirection vers login
    if (error && !isAuthenticated && !isOnLoginPage && !hasRedirected) {
      setHasRedirected(true);
      clearError();
      router.replace('/login');
      return;
    }

    // CAS 2: Non authentifié + Accès zone protégée -> Redirection login
    if (!isAuthenticated && inAuthGroup && !hasRedirected) {
      setHasRedirected(true);
      clearError();
      router.replace('/login');
      return;
    }

    // CAS 3: Session invalide + Zone protégée -> Redirection login
    if (!sessionValid && inAuthGroup && !hasRedirected) {
      setHasRedirected(true);
      clearError();
      router.replace('/login');
      return;
    }

    // CAS 4: Authentifié + Sur page login -> Redirection tabs
    if (isAuthenticated && sessionValid && isOnLoginPage && !hasRedirected) {
      setHasRedirected(true);
      clearError();
      router.replace('/(tabs)');
      return;
    }

    // Réinitialiser le flag de redirection si on arrive sur une nouvelle page
    if (hasRedirected && !isLoading) {
      setHasRedirected(false);
    }

  }, [isAuthenticated, isLoading, segments, pathname, error, sessionValid, clearError, hasRedirected]);

  // Écran de chargement pendant la vérification auth
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Vérification...</Text>
      </View>
    );
  }

  // ❌ Si erreur persistante, afficher l'écran de chargement (la redirection est en cours)
  if (error && !isAuthenticated) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#dc2626" />
        <Text style={styles.errorText}>Redirection...</Text>
      </View>
    );
  }

  return <>{children}</>;
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2563eb',
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 16,
    marginTop: 12,
    fontWeight: '500',
  },
  errorText: {
    color: '#ffffff',
    fontSize: 16,
    marginTop: 12,
    fontWeight: '500',
  },
});
