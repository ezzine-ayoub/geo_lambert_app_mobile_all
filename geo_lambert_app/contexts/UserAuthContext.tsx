import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService, AuthUser, AuthResponse } from '../services/authService';

// ==================== INTERFACES ====================

interface UserAuthData {
  success: boolean;
  user_info: AuthUser;
  CREDENTIALS: {
    username: string;
    password: string;
  };
  db: string;
  timestamp: number;
  isAuthenticated: boolean;
}

interface UserAuthContextType {
  userAuth: UserAuthData | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  login: (username: string, password: string, db?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  clearError: () => void;
  
  // Getters
  getCurrentUser: () => AuthUser | null;
  getCredentials: () => { username: string; password: string; db: string } | null;
  
  // États
  sessionValid: boolean;
}

// ==================== CONTEXT ====================

const UserAuthContext = createContext<UserAuthContextType | undefined>(undefined);

interface UserAuthProviderProps {
  children: ReactNode;
}

export function UserAuthProvider({ children }: UserAuthProviderProps) {
  const [userAuth, setUserAuth] = useState<UserAuthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionValid, setSessionValid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ CORRECTION: useCallback pour éviter les re-renders excessifs
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ✅ CORRECTION: Fonction utilitaire pour gérer les erreurs
  const handleError = useCallback((error: any, context: string) => {
    console.error(`❌ [UserAuth] Erreur ${context}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue';
    setError(`${context}: ${errorMessage}`);
  }, []);

  // 🔄 Vérifier l'authentification au démarrage
  useEffect(() => {
    let isMounted = true;
    
    const checkAuthStatus = async () => {
      try {
        console.log('🔍 [UserAuth] Vérification du statut d\'authentification...');
        setIsLoading(true);
        setError(null);

        
        // Vérifier si une session est active
        const isAuth = await authService.isAuthenticated();
        const isValid = await authService.isSessionValid();
        
        console.log('🔍 [UserAuth] État authentification:', { isAuth, isValid });
        
        if (!isMounted) return;

        if (isAuth && isValid) {
          try {
            // Récupérer les données de session
            const authData = await authService.getStoredAuthData();
            const credentials = await authService.getStoredCredentials();
            
            console.log('🔍 [UserAuth] Données récupérées:', { 
              hasAuthData: !!authData, 
              hasCredentials: !!credentials,
              authSuccess: authData?.success,
              userDisplay: authData?.user_info?.display_name
            });
            
            if (authData && credentials && authData.success && isMounted) {
              const userData: UserAuthData = {
                success: authData.success,
                user_info: authData.user_info,
                CREDENTIALS: {
                  username: credentials.username,
                  password: credentials.password
                },
                db: credentials.db,
                timestamp: Date.now(),
                isAuthenticated: true
              };

              setUserAuth(userData);
              setSessionValid(true);
              console.log(`✅ [UserAuth] Session restaurée pour: ${authData.user_info.display_name}`);
            } else {
              console.log('⚠️ [UserAuth] Données de session incomplètes ou invalides');
              if (isMounted) {
                setUserAuth(null);
                setSessionValid(false);
              }
            }
          } catch (sessionError) {
            console.error('❌ [UserAuth] Erreur récupération session:', sessionError);
            if (isMounted) {
              setUserAuth(null);
              setSessionValid(false);
              // Ne pas afficher l'erreur à l'utilisateur pour l'init
            }
          }
        } else {
          console.log('❌ [UserAuth] Aucune session valide trouvée');
          if (isMounted) {
            setUserAuth(null);
            setSessionValid(false);
          }
        }

      } catch (error) {
        console.error('❌ [UserAuth] Erreur vérification statut:', error);
        if (isMounted) {
          setUserAuth(null);
          setSessionValid(false);
          // Ne pas afficher l'erreur à l'utilisateur pour l'init
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    checkAuthStatus();

    return () => {
      isMounted = false;
    };
  }, []); // Dépendances vides pour n'exécuter qu'une fois

  // 🔑 Fonction de connexion avec gestion d'erreurs améliorée
  const login = useCallback(async (username: string, password: string, db: string = 'odoo'): Promise<boolean> => {
    try {
      setIsLoading(true);
      setError(null);
      console.log(`🔐 [UserAuth] Tentative de connexion pour: ${username}`);

      // ✅ CORRECTION: Validation des paramètres
      if (!username.trim() || !password.trim()) {
        throw new Error('Nom d\'utilisateur et mot de passe requis');
      }

      // ✅ CORRECTION: Récupérer l'URL du serveur configurée
      let serverUrl = 'https://ce791a46916a.ngrok-free.app'; // URL par défaut
      
      try {
        // Essayer de récupérer depuis AsyncStorage la config serveur
        const storedData = await AsyncStorage.getItem('@geo_lambert_server_config');
        if (storedData) {
          const serverConfig = JSON.parse(storedData);
          if (serverConfig.data && serverConfig.data.server_url) {
            serverUrl = serverConfig.data.server_url;
            console.log('🔧 [UserAuth] URL serveur récupérée depuis config:', serverUrl);
          }
        }
      } catch (configError) {
        console.log('🔧 [UserAuth] Utilisation URL serveur par défaut:', serverUrl);
      }

      // Authentifier via authService avec l'URL du serveur
      const authData = await authService.authenticate({
        username: username.trim(),
        password,
        db,
        server_url: serverUrl
      });

      if (authData.success && authData.user_info) {
        // ✅ CORRECTION: S'assurer que les credentials sont ajoutées
        const completeAuthData = {
          ...authData,
          CREDENTIALS: authData.CREDENTIALS || { username, password }
        };
        
        // Mettre à jour l'état global
        const userData: UserAuthData = {
          success: completeAuthData.success,
          user_info: completeAuthData.user_info,
          CREDENTIALS: { username, password },
          db,
          timestamp: Date.now(),
          isAuthenticated: true
        };

        setUserAuth(userData);
        setSessionValid(true);
        
        console.log(`✅ [UserAuth] Connexion réussie: ${completeAuthData.user_info.display_name}`);
        return true;
      } else {
        const errorMsg = authData.message || 'Identifiants incorrects';
        setError(errorMsg);
        console.log('❌ [UserAuth] Connexion échouée:', errorMsg);
        return false;
      }
      
    } catch (error) {
      handleError(error, 'Connexion');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [handleError]);

  // 🚪 Fonction de déconnexion avec gestion d'erreurs
  const logout = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      console.log('🚪 [UserAuth] Déconnexion en cours...');
      
      // Déconnecter via authService
      await authService.logout();

      // Nettoyer l'état global
      setUserAuth(null);
      setSessionValid(false);
      
      console.log('✅ [UserAuth] Déconnexion terminée');
      
    } catch (error) {
      handleError(error, 'Déconnexion');
      // Forcer la déconnexion même en cas d'erreur
      setUserAuth(null);
      setSessionValid(false);
    } finally {
      setIsLoading(false);
    }
  }, [handleError]);

  // 🔄 Rafraîchir la session avec gestion d'erreurs
  const refreshSession = useCallback(async (): Promise<void> => {
    try {
      console.log('🔄 [UserAuth] Rafraîchissement de la session...');
      setError(null);

      // Mettre à jour le timestamp local
      if (userAuth) {
        setUserAuth(prev => prev ? {
          ...prev,
          timestamp: Date.now()
        } : null);
      }
      
      console.log('✅ [UserAuth] Session rafraîchie');
      
    } catch (error) {
      handleError(error, 'Rafraîchissement session');
    }
  }, [userAuth, handleError]);

  // 👤 Récupérer l'utilisateur actuel
  const getCurrentUser = useCallback((): AuthUser | null => {
    return userAuth?.user_info || null;
  }, [userAuth]);

  // 🗝 Récupérer les credentials
  const getCredentials = useCallback((): { username: string; password: string; db: string } | null => {
    if (userAuth && userAuth.CREDENTIALS) {
      return {
        username: userAuth.CREDENTIALS.username,
        password: userAuth.CREDENTIALS.password,
        db: userAuth.db
      };
    }
    return null;
  }, [userAuth]);

  // ✅ CORRECTION: Utiliser useMemo pour les valeurs calculées
  const isAuthenticated = React.useMemo(() => {
    return !!userAuth?.isAuthenticated && !!userAuth?.CREDENTIALS;
  }, [userAuth]);

  // 📊 Valeurs du contexte avec useMemo pour optimiser les performances
  const contextValue = React.useMemo((): UserAuthContextType => ({
    userAuth,
    isAuthenticated,
    isLoading,
    sessionValid,
    error,
    
    // Actions
    login,
    logout,
    refreshSession,
    clearError,
    
    // Getters
    getCurrentUser,
    getCredentials,
  }), [
    userAuth,
    isAuthenticated,
    isLoading,
    sessionValid,
    error,
    login,
    logout,
    refreshSession,
    clearError,
    getCurrentUser,
    getCredentials,
  ]);

  return (
    <UserAuthContext.Provider value={contextValue}>
      {children}
    </UserAuthContext.Provider>
  );
}

// ==================== HOOK PERSONNALISÉ ====================

export function useUserAuth() {
  const context = useContext(UserAuthContext);
  if (context === undefined) {
    throw new Error('useUserAuth doit être utilisé dans un UserAuthProvider');
  }
  return context;
}

// ==================== HOOKS UTILITAIRES ====================

/**
 * Hook pour récupérer seulement l'utilisateur
 */
export function useCurrentUser(): AuthUser | null {
  const { getCurrentUser } = useUserAuth();
  return getCurrentUser();
}

/**
 * Hook pour récupérer seulement les credentials
 */
export function useCredentials() {
  const { getCredentials } = useUserAuth();
  return getCredentials();
}

/**
 * Hook pour vérifier si l'utilisateur est connecté
 */
export function useIsAuthenticated(): boolean {
  const { isAuthenticated } = useUserAuth();
  return isAuthenticated;
}

/**
 * Hook pour les actions d'authentification
 */
export function useAuthActions() {
  const { login, logout, refreshSession } = useUserAuth();
  return { login, logout, refreshSession };
}

/**
 * ✅ NOUVEAU: Hook pour la gestion des erreurs
 */
export function useAuthError() {
  const { error, clearError } = useUserAuth();
  return { error, clearError };
}

// ==================== COMPOSANT HOC ====================

/**
 * HOC pour protéger des routes (nécessite authentification)
 * ✅ CORRECTION: Gestion améliorée avec loading et erreurs
 */
export function withAuth<T extends object>(WrappedComponent: React.ComponentType<T>) {
  return function AuthenticatedComponent(props: T) {
    const { isAuthenticated, isLoading, error } = useUserAuth();
    
    if (isLoading) {
      return (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div>Vérification de l&#39;authentification...</div>
        </div>
      );
    }
    
    if (error) {
      return (
        <div style={{ padding: '20px', textAlign: 'center', color: 'red' }}>
          <div>Erreur d&#39;authentification: {error}</div>
        </div>
      );
    }
    
    if (!isAuthenticated) {
      return (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div>Accès non autorisé - Veuillez vous connecter</div>
        </div>
      );
    }
    
    return <WrappedComponent {...props} />;
  };
}

export type { UserAuthData, UserAuthContextType };
