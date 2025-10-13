import React, { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { authService } from '../services/authService';
import { useUserAuth } from '../contexts/UserAuthContext';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  Alert, 
  Image,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native';

const LoginPage: React.FC = () => {
  const { isAuthenticated, login: userAuthLogin, error: authError, clearError } = useUserAuth();
  const [serverUrl, setServerUrl] = useState('');
  const [serverConfig, setServerConfig] = useState(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    db: 'odoo' // Fixé à odoo
  });
  const [isConnectingServer, setIsConnectingServer] = useState(false);
  const [isServerConnected, setIsServerConnected] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Nettoyer les erreurs au montage
  useEffect(() => {
    clearError();
    return () => {
      clearError();
    };
  }, [clearError]);

  // Si déjà authentifié, AuthGuard se charge de la redirection

  const handleServerConnect = async () => {
    if (!serverUrl.trim()) {
      Alert.alert('Erreur', 'L\'URL du serveur est requise');
      return;
    }

    setIsConnectingServer(true);

    try {
      
      // Étape 1: Récupérer la configuration du serveur
      const configResult = await authService.fetchAndConfigureServer(serverUrl);
      
      if (configResult.success && configResult.config) {
        setServerConfig(configResult.config);
        setIsServerConnected(true);
        
        Alert.alert(
          'Connexion réussie', 
          `Serveur connecté!\n\nVersion Odoo: ${configResult.config.odoo_version}\nAPI Version: ${configResult.config.api_version}`
        );
      } else {
        throw new Error(configResult.error || 'Configuration serveur invalide');
      }
      
    } catch (error) {
      
      // Réinitialiser les champs en cas d'erreur
      setIsServerConnected(false);
      setServerConfig(null);
      
      Alert.alert(
        'Erreur serveur', 
        error instanceof Error ? error.message : 'Impossible de se connecter au serveur.\n\nVeuillez vérifier l\'URL et votre connexion internet.',
        [
          {
            text: 'Réessayer',
            onPress: () => {}
          }
        ]
      );
    } finally {
      setIsConnectingServer(false);
    }
  };

  const handleLogin = async () => {
    if (!formData.username.trim()) {
      Alert.alert('Erreur', 'Le nom d\'utilisateur est requis');
      return;
    }
    
    if (!formData.password.trim()) {
      Alert.alert('Erreur', 'Le mot de passe est requis');
      return;
    }

    // DB est fixée à 'odoo' - pas besoin de vérification

    setIsLoggingIn(true);

    try {
      // S'assurer que la configuration du serveur est bien faite avant l'auth
      const configResult = await authService.fetchAndConfigureServer(serverUrl);
      if (!configResult.success) {
        throw new Error(configResult.error || 'Configuration serveur impossible');
      }
      
      // Utiliser UserAuth login
      const success = await userAuthLogin(
        formData.username,
        formData.password,
        formData.db
      );
      
      if (success) {
        // AuthGuard gère la redirection
      } else {
        // Authentification échouée - Réinitialiser l'état
        const errorMessage = authError || 'Identifiants incorrects';
        
        // Réinitialiser le formulaire
        setFormData({ username: '', password: '', db: 'odoo' });
        setIsServerConnected(false);
        setServerConfig(null);
        
        Alert.alert(
          'Erreur d\'authentification', 
          errorMessage + '\n\nVeuillez vérifier vos identifiants et réessayer.',
          [
            {
              text: 'OK',
              onPress: () => {}
            }
          ]
        );
      }
      
    } catch (error) {
      
      // Réinitialiser le formulaire
      setFormData({ username: '', password: '', db: 'odoo' });
      setIsServerConnected(false);
      setServerConfig(null);
      
      Alert.alert(
        'Erreur de connexion', 
        error instanceof Error ? error.message : 'Erreur de connexion au serveur.\n\nVeuillez vérifier votre connexion et réessayer.',
        [
          {
            text: 'Réessayer',
            onPress: () => {}
          }
        ]
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const resetConnection = () => {
    setIsServerConnected(false);
    setServerConfig(null);
    setFormData({ username: '', password: '', db: 'odoo' });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
      
      <KeyboardAvoidingView 
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Image
                source={require('../assets/images/geo-lambert.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.title}>GEO LAMBERT</Text>
            <Text style={styles.subtitle}>L'Art de mesure et de précision</Text>
          </View>
          
          {/* Main Card */}
          <View style={styles.card}>
            
            {/* Step 1: Server */}
            {!isServerConnected ? (
              <>
                <Text style={styles.cardTitle}>Connexion serveur</Text>
                
                <Text style={styles.label}>Serveur</Text>
                <TextInput
                  style={styles.input}
                  value={serverUrl}
                  onChangeText={setServerUrl}
                  placeholder="https://votre-serveur.com"
                  placeholderTextColor="#9ca3af"
                  editable={!isConnectingServer}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="done"
                />
                
                <TouchableOpacity
                  style={[styles.button, isConnectingServer && styles.buttonDisabled]}
                  onPress={handleServerConnect}
                  disabled={isConnectingServer}
                >
                  <Text style={styles.buttonText}>
                    {isConnectingServer ? 'Connexion...' : 'Connecter'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              /* Step 2: Login */
              <>
                <Text style={styles.cardTitle}>Authentification</Text>

                <View style={styles.serverConnected}>
                  <View style={styles.serverInfo}>
                    <Text style={styles.serverText}>✓ Serveur connecté</Text>
                    {serverConfig && (
                      <Text style={styles.versionText}>
                        Odoo {serverConfig.odoo_version} • API {serverConfig.api_version}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity onPress={resetConnection}>
                    <Text style={styles.changeText}>Changer</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>Utilisateur</Text>
                <TextInput
                  style={styles.input}
                  value={formData.username}
                  onChangeText={(text) => setFormData({...formData, username: text})}
                  placeholder="Identifiant"
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoggingIn}
                  returnKeyType="next"
                  autoComplete="username"
                />
                
                <Text style={styles.label}>Mot de passe</Text>
                <TextInput
                  style={styles.input}
                  value={formData.password}
                  onChangeText={(text) => setFormData({...formData, password: text})}
                  placeholder="Mot de passe"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  editable={!isLoggingIn}
                  returnKeyType="done"
                  autoComplete="current-password"
                  onSubmitEditing={handleLogin}
                />
                
                <TouchableOpacity
                  style={[styles.button, styles.loginButton, isLoggingIn && styles.buttonDisabled]}
                  onPress={handleLogin}
                  disabled={isLoggingIn}
                >
                  <Text style={styles.buttonText}>
                    {isLoggingIn ? 'Connexion...' : 'Se connecter'}
                  </Text>
                </TouchableOpacity>

                <View style={styles.demo}>
                  <Text style={styles.demoText}>Base de données fixée : odoo</Text>
                </View>
              </>
            )}
            
          </View>
          
          {/* Footer */}
          <Text style={styles.footer}>GEO LAMBERT - Solutions géomatiques</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2563eb',
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    paddingBottom: 60,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
    width: '100%',
    maxWidth: 400,
  },
  logoContainer: {
    width: 140,
    height: 80,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  logo: {
    width: 120,
    height: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 16,
    fontStyle: 'italic',
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 4,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    marginBottom: 20,
    width: '100%',
    maxWidth: 400,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
    textAlign: 'center',
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#f9fafb',
    color: '#111827',
    marginBottom: 4,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  loginButton: {
    backgroundColor: '#0891b2',
  },
  buttonDisabled: {
    backgroundColor: '#9ca3af',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  serverConnected: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#cffafe',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  serverInfo: {
    flex: 1,
  },
  serverText: {
    color: '#0e7490',
    fontWeight: 'bold',
    fontSize: 14,
  },
  versionText: {
    color: '#0891b2',
    fontSize: 12,
    marginTop: 2,
  },
  changeText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  demo: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  demoText: {
    fontSize: 14,
    color: '#92400e',
    textAlign: 'center',
    fontWeight: '500',
  },
  footer: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
    width: '100%',
    maxWidth: 400,
  },
});

export default LoginPage;
