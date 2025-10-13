import React, { createContext, useContext, ReactNode } from 'react';
import { useUserAuth } from './UserAuthContext';

// ⚠️ ANCIEN AuthContext - Redirige vers UserAuth pour compatibilité
// Utilisez UserAuthContext à la place !

interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  display_name?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Provider de transition qui utilise UserAuth en arrière-plan
export function AuthProvider({ children }: { children: ReactNode }) {
  console.warn('⚠️ AuthProvider utilisé - migrez vers UserAuthProvider');
  
  // Utiliser UserAuth en arrière-plan
  const { 
    isAuthenticated: userAuthIsAuthenticated, 
    isLoading: userAuthIsLoading, 
    login: userAuthLogin, 
    logout: userAuthLogout,
    getCurrentUser
  } = useUserAuth();

  // Adapter les données UserAuth vers l'ancien format
  const currentUser = getCurrentUser();
  const adaptedUser: User | null = currentUser ? {
    id: currentUser.id.toString(),
    name: currentUser.display_name || currentUser.username,
    email: currentUser.username + '@temp.com', // Email temporaire
    display_name: currentUser.display_name,
  } : null;

  // Adapter les fonctions
  const login = async (email: string, password: string): Promise<boolean> => {
    console.warn('⚠️ AuthProvider.login() - utilisez UserAuth à la place');
    return await userAuthLogin(email, password);
  };

  const logout = async (): Promise<void> => {
    console.warn('⚠️ AuthProvider.logout() - utilisez UserAuth à la place');
    return await userAuthLogout();
  };

  const value: AuthContextType = {
    user: adaptedUser,
    isAuthenticated: userAuthIsAuthenticated,
    isLoading: userAuthIsLoading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook de transition
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error(`
    ❌ useAuth doit être utilisé dans un AuthProvider
    
    🔧 SOLUTION: Migrez vers UserAuth
    
    ❌ Ancien: import { useAuth } from '@/contexts/AuthContext';
    ✅ Nouveau: import { useUserAuth, useCurrentUser } from '@/contexts/UserAuthContext';
    
    ❌ Ancien: const { user, isAuthenticated, logout } = useAuth();
    ✅ Nouveau: const { isAuthenticated, logout } = useUserAuth();
               const currentUser = useCurrentUser();
    `);
  }
  
  console.warn('⚠️ useAuth() utilisé - migrez vers useUserAuth()');
  return context;
}

