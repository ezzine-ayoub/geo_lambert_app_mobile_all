import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { router, useSegments } from 'expo-router';
import { useUserAuth } from '../contexts/UserAuthContext';

interface AuthGuardProps {
  children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isAuthenticated, isLoading, error } = useUserAuth();
  const segments = useSegments();

  useEffect(() => {
    if (!isLoading && !error) {
      const inAuthGroup = segments[0] === '(tabs)';
      const inLoginPage = segments.includes('login');
      
      if (!isAuthenticated && inAuthGroup) {
        // Utilisateur non authentifié essayant d'accéder aux pages protégées
        console.log('🚫 Accès refusé - Redirection vers login');
        router.replace('/login');
      } else if (isAuthenticated && inLoginPage) {
        // Utilisateur authentifié sur la page login
        console.log('✅ Utilisateur déjà connecté - Redirection vers home');
        router.replace('/(tabs)');
      }
    }
  }, [isAuthenticated, isLoading, segments, error]);

  // Écran de chargement pendant la vérification auth
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Vérification...</Text>
      </View>
    );
  }

  // Écran d'erreur si problème d'authentification
  if (error && !isAuthenticated) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Erreur d'authentification</Text>
        <Text style={styles.errorText}>{error}</Text>
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    padding: 20,
  },
  errorTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  errorText: {
    color: '#ffffff',
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.9,
  },
});
