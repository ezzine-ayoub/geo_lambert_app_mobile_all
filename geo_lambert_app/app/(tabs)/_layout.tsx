import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {Alert, Platform} from 'react-native';

import { HapticTab } from '@/components/HapticTab';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from "@expo/vector-icons";
import webSocketService from '@/services/webSocketService';
import cashboxService from '@/services/cashboxService';
import { authService } from '@/services/authService';
import { useUserAuth } from '@/contexts/UserAuthContext';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);
  const { refreshUserData } = useUserAuth();

  useEffect(() => {
    console.log('🚀 Initialisation TabLayout - Configuration WebSocket Geo Lambert...');

    // Initialiser la connexion WebSocket
    const initializeWebSocket = async () => {
      try {
        console.log('🔗 Connexion au WebSocket...');
        await webSocketService.connect();
        console.log('✅ WebSocket connecté avec succès');

        // Configurer tous les listeners Geo Lambert
        setupGeoLambertListeners();

      } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation du WebSocket:', error);
      }
    };

    // Configuration des listeners Geo Lambert
    const setupGeoLambertListeners = () => {

      // 👤 USER AUTH - Canal privé: geo_lambert_res_users_id_{user_id}
      webSocketService.onUserAuthUpdate(async (userData) => {
        try {
          console.log('👤 Événement mise à jour utilisateur WebSocket:', {
            event_type: userData.event_type || 'updated',
            user_id: userData.id,
            display_name: userData.display_name || userData.name,
            balance: userData.balance,
            case_id: userData.case_id
          });

          // Mettre à jour les données dans le service d'authentification
          const updated = await authService.updateUserFromWebSocket(userData);
          
          if (updated) {
            console.log('✅ Données utilisateur mises à jour dans le storage');
            
            // Rafraîchir le contexte pour mettre à jour toutes les vues
            await refreshUserData();
            console.log('✅ Interface utilisateur rafraîchie');
          }

        } catch (error) {
          console.error('❌ Erreur traitement event WebSocket user auth:', error);
        }
      });

      // 🔥 CANAL UNIFIÉ - Tous les événements de projets, tâches et catégories
      webSocketService.onUnifiedChannelUpdate({
        onCategoryUpdate: async (category) => {
          console.log('📂 Mise à jour Catégorie reçue:', category.id, 'Type:', category.event_type);
        },
        
        onProjectUpdate: async (project) => {
          console.log('📦 Mise à jour Project reçue:', project.id, 'Type:', project.event_type);
        },
        
        onTaskUpdate: async (task) => {
          console.log('✅ Mise à jour Task reçue:', task.id, 'Type:', task.event_type);
        }
      });

      // 💸 DÉPENSES DE CAISSE - Canal privé: geo_lambert_expense_caisse_{case_id}_{user_id}
      webSocketService.onCashboxExpenseUpdate(async (expenseData) => {
        try {
          console.log('💸 Événement dépense de caisse WebSocket:', {
            event_type: expenseData.event_type || 'unknown',
            expense_id: expenseData.id,
            expense_move_type: expenseData.expense_move_type,
            solde_amount: expenseData.solde_amount,
            task_name: expenseData.task_id && expenseData.task_id.length > 0 
              ? expenseData.task_id[0].name 
              : 'N/A'
          });

          // ✅ Mise à jour directe du SQLite depuis le payload WebSocket
          const currentUser = await authService.getCurrentUser();
          if (currentUser?.employee_id) {
            const employeeId = parseInt(currentUser.employee_id);
            console.log('📡 Mise à jour directe SQLite depuis payload WebSocket...');
            
            // ✅ Utiliser updateCashboxFromWebSocket au lieu de forceRefreshCashbox
            const result = await cashboxService.updateCashboxFromWebSocket(employeeId, expenseData);
            
            if (result.success) {
              console.log('✅ Cashbox SQLite + vue mis à jour depuis WebSocket');
            } else {
              console.warn('⚠️ Échec mise à jour directe:', result.message);
            }
          }

        } catch (error) {
          console.error('❌ Erreur traitement event WebSocket cashbox:', error);
        }
      });

      // 📅 MOIS DE DÉPENSES - Canal privé: geo_lambert_expense_month_caisse_{case_id}_{user_id}
      webSocketService.onExpenseMonthUpdate(async (monthData) => {
        try {
          console.log('📅 Événement mois de dépenses WebSocket:', {
            event_type: monthData.event_type || 'unknown',
            month_id: monthData.id,
            month_name: monthData.name || monthData.display_name,
            caisse_id: monthData.caisse_id ? monthData.caisse_id[0] : 'N/A'
          });

          // ✅ Mise à jour directe du SQLite depuis le payload WebSocket
          const currentUser = await authService.getCurrentUser();
          if (currentUser?.case_id) {
            const caseId = currentUser.case_id;
            console.log('📡 Mise à jour directe SQLite mois depuis payload WebSocket...');
            
            // ✅ Utiliser updateExpenseMonthFromWebSocket
            const { expenseAccountService } = await import('@/services/expenseAccountService');
            const result = await expenseAccountService.updateExpenseMonthFromWebSocket(caseId, monthData);
            
            if (result.success) {
              console.log('✅ Mois SQLite + vue mis à jour depuis WebSocket');
            } else {
              console.warn('⚠️ Échec mise à jour directe mois:', result.message);
            }
          }

        } catch (error) {
          console.error('❌ Erreur traitement event WebSocket mois:', error);
        }
      });

      // 📡 STATUT DE CONNEXION
      webSocketService.onConnectionStatusChange((connected) => {
        setIsWebSocketConnected(connected);
        if (connected) {
          console.log('✅ WebSocket reconnecté - Tous les listeners sont actifs');
        } else {
          console.log('⚠️ WebSocket déconnecté - Tentative de reconnexion automatique...');
        }
      });

      console.log('🎯 Tous les listeners Geo Lambert configurés avec succès');
    };

    // Démarrer l'initialisation
    initializeWebSocket();

    // Nettoyage au démontage du composant
    return () => {
      console.log('🧹 Nettoyage TabLayout - Déconnexion WebSocket...');

      // Nettoyer tous les listeners
      webSocketService.unsubscribeAll();

      // Déconnecter le WebSocket
      webSocketService.disconnect();

      console.log('✅ WebSocket déconnecté proprement');
    };
  }, [refreshUserData]); // Ajouter refreshUserData dans les dépendances

  return (
      <Tabs
          screenOptions={{
              tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
              headerShown: false,
              tabBarButton: HapticTab,
              tabBarBackground: TabBarBackground,
              tabBarStyle: Platform.select({
                  ios: {
                      // Use a transparent background on iOS to show the blur effect
                      position: 'absolute',
                  },
                  default: {},
              }),
          }}>
          <Tabs.Screen
              name="index"
              options={{
                  title: 'Produits',
                  tabBarIcon: ({ color, focused }) => (
                      <Ionicons
                          name={focused ? 'storefront' : 'storefront-outline'}
                          size={26}
                          color={color}
                      />
                  ),
              }}
          />

          <Tabs.Screen
              name="details-solde"
              options={{
                  title: 'Solde',
                  tabBarIcon: ({ color, focused }) => (
                      <Ionicons
                          name={focused ? 'wallet' : 'wallet-outline'}
                          size={26}
                          color={color}
                      />
                  ),
              }}
          />
          <Tabs.Screen
              name="expense-months"
              options={{
                  title: 'Mes Mois',
                  tabBarIcon: ({ color, focused }) => (
                      <Ionicons
                          name={focused ? 'calendar' : 'calendar-outline'}
                          size={26}
                          color={color}
                      />
                  ),
              }}
          />
          <Tabs.Screen
              name="profile"
              options={{
                  title: 'Profil',
                  tabBarIcon: ({ color, focused }) => (
                      <Ionicons
                          name={focused ? 'person-circle' : 'person-circle-outline'}
                          size={26}
                          color={color}
                      />
                  ),
              }}
          />
          <Tabs.Screen
              name="project-details"
              options={{
                  href: null, // Cache cette page de la tab bar
              }}
          />
          <Tabs.Screen
              name="task-expenses"
              options={{
                  href: null, // Cache cette page de la tab bar
              }}
          />
      </Tabs>
  );
}
